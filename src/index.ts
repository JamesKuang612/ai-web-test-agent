import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createCaseDirectories,
  createManifest,
  explore,
  generateAsset,
  getCasePaths,
  readManifest,
  repairOptimized,
  saveManifest,
  validateSpec,
  writeJson,
  type AssetRecord,
  type CaseManifest,
  type RunMode,
  type RunRecord,
} from './core.js';
import { extractTrace, printTrace } from './trace.js';

/** 返回指定 CLI 选项后面的值。 */
function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/** 读取必填 CLI 选项，缺失时给出明确错误。 */
function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`缺少必填参数 ${name}。`);
  return value;
}

/** 将失败原因转成适合 manifest 的简短文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 构造一条最小运行记录。 */
function runRecord(
  mode: RunMode,
  status: 'PASS' | 'FAIL',
  durationMs: number,
  threadId: string | null,
  traceFile: string | null,
  error: string | null,
): RunRecord {
  return {
    mode,
    status,
    durationMs,
    runAt: new Date().toISOString(),
    threadId,
    traceFile,
    error,
  };
}

/** 编译并验证一份 Conservative 或 Optimized 资产。 */
async function compileAsset(
  kind: 'conservative' | 'optimized',
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
  source: string,
): Promise<AssetRecord> {
  const file = kind === 'conservative' ? paths.conservative : paths.optimized;
  await writeFile(file, source, 'utf8');
  console.log(`\n[VALIDATE ${kind.toUpperCase()}] ${path.relative(process.cwd(), file)}`);
  const validation = await validateSpec(file);
  const record = manifest[kind];
  record.status = validation.status;
  record.validation = validation;
  await saveManifest(paths, manifest);
  console.log(`[${kind.toUpperCase()}] ${record.status}`);
  return record;
}

/** 执行正式 Explore → Compile → Validate 流程。 */
async function compileCommand(args: string[]): Promise<void> {
  const caseId = requiredOption(args, '--case');
  const instructionFile = path.resolve(requiredOption(args, '--instruction'));
  const instruction = (await readFile(instructionFile, 'utf8')).trim();
  if (!instruction) throw new Error('instruction 文件不能为空。');

  const paths = getCasePaths(caseId);
  await createCaseDirectories(paths);
  await writeFile(paths.instruction, `${instruction}\n`, 'utf8');
  const manifest = createManifest(caseId, instruction);
  await saveManifest(paths, manifest);

  try {
    console.log(`[COMPILE] ${caseId}`);
    console.log('[EXPLORE] 创建新的 Codex thread');
    const explored = await explore(instruction);
    await writeJson(paths.rawTrace, explored.trace);
    manifest.threadId = explored.threadId;
    manifest.explore = {
      status: explored.status,
      durationMs: explored.durationMs,
      finalResponse: explored.finalResponse,
      traceFile: 'raw-trace.json',
      mcpCalls: explored.trace.length,
    };
    await saveManifest(paths, manifest);
    printTrace(explored.items);
    console.log(`\n[EXPLORE FINAL]\n${explored.finalResponse}`);

    if (explored.status !== 'PASS') {
      throw new Error('Agent Explore 未通过，未生成离线资产。');
    }

    console.log('\n[GENERATE CONSERVATIVE]');
    const conservative = await generateAsset(
      explored.thread,
      'conservative',
      instruction,
      explored.trace,
    );
    await compileAsset('conservative', paths, manifest, conservative);

    console.log('\n[GENERATE OPTIMIZED]');
    let optimizedSource = await generateAsset(
      explored.thread,
      'optimized',
      instruction,
      explored.trace,
    );
    const optimized = await compileAsset(
      'optimized',
      paths,
      manifest,
      optimizedSource,
    );

    if (optimized.status === 'INVALID') {
      console.log('\n[REPAIR OPTIMIZED] 唯一一次 Agentic Repair');
      optimized.repaired = true;
      const failure = optimized.validation?.error ?? 'Playwright 未返回失败详情。';
      const repaired = await repairOptimized(
        explored.threadId,
        instruction,
        explored.trace,
        optimizedSource,
        failure,
      );
      optimizedSource = repaired.source;
      const repairTrace = extractTrace(repaired.items);
      optimized.repairMcpCalls = repairTrace.length;
      if (repairTrace.length > 0) {
        const repairTraceFile = path.join(paths.directory, 'optimized-repair-trace.json');
        await writeJson(repairTraceFile, repairTrace);
        optimized.repairTraceFile = 'optimized-repair-trace.json';
      }
      printTrace(repaired.items);
      await compileAsset('optimized', paths, manifest, optimizedSource);
    }

    manifest.pipelineStatus = 'COMPLETED';
    await saveManifest(paths, manifest);
    console.log(`\n[COMPILE COMPLETE] ${paths.directory}`);
  } catch (error) {
    manifest.pipelineStatus = 'FAILED';
    manifest.pipelineError = errorMessage(error);
    await saveManifest(paths, manifest);
    throw error;
  }
}

/** 执行已经通过 Fresh Validation 的离线 Playwright 资产。 */
async function runReplay(
  mode: 'conservative' | 'optimized',
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<void> {
  const asset = manifest[mode];
  if (asset.status !== 'VALIDATED') {
    throw new Error(`${mode} Asset 当前为 ${asset.status}，不可执行且不会 fallback 到 Agent。`);
  }
  console.log('[CODEX CALLS] 0');
  const result = await validateSpec(path.join(paths.directory, asset.file));
  const status = result.status === 'VALIDATED' ? 'PASS' : 'FAIL';
  manifest.runs.push(
    runRecord(mode, status, result.durationMs, null, null, result.error),
  );
  await saveManifest(paths, manifest);
  console.log(`[RUN ${mode.toUpperCase()}] ${status}`);
  if (status === 'FAIL') process.exitCode = 1;
}

/** 使用新的 Codex thread 重新执行已保存 instruction。 */
async function runAgent(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<void> {
  console.log('[AGENT] 创建新的 Codex thread');
  const explored = await explore(manifest.originalInstruction);
  const traceName = `${Date.now()}-agent-trace.json`;
  await writeJson(path.join(paths.runs, traceName), explored.trace);
  manifest.runs.push(
    runRecord(
      'agent',
      explored.status,
      explored.durationMs,
      explored.threadId,
      path.join('runs', traceName).replaceAll('\\', '/'),
      explored.status === 'PASS' ? null : explored.finalResponse,
    ),
  );
  await saveManifest(paths, manifest);
  console.log(`[THREAD ID] ${explored.threadId}`);
  printTrace(explored.items);
  console.log(`\n[AGENT FINAL]\n${explored.finalResponse}`);
  if (explored.status === 'FAIL') process.exitCode = 1;
}

/** 根据 mode 分派离线 Replay 或新的 Agent Explore。 */
async function runCommand(args: string[]): Promise<void> {
  const caseId = requiredOption(args, '--case');
  const requestedMode = requiredOption(args, '--mode');
  if (!['agent', 'conservative', 'optimized'].includes(requestedMode)) {
    throw new Error('--mode 必须是 agent、conservative 或 optimized。');
  }
  const mode = requestedMode as RunMode;
  const paths = getCasePaths(caseId);
  const manifest = await readManifest(paths);
  if (mode === 'agent') await runAgent(paths, manifest);
  else await runReplay(mode, paths, manifest);
}

/** 输出正式 V0 CLI 的最小用法。 */
function printUsage(): void {
  console.log(`用法：
  npm start -- compile --case <id> --instruction <file>
  npm start -- run --case <id> --mode <agent|conservative|optimized>`);
}

/** 解析顶层命令并运行正式 V0。 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'compile') return compileCommand(args);
  if (command === 'run') return runCommand(args);
  printUsage();
  if (command) throw new Error(`未知命令：${command}`);
}

main().catch((error: unknown) => {
  console.error(`错误：${errorMessage(error)}`);
  process.exitCode = 1;
});
