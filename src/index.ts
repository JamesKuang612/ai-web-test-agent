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
  resumeAgentThread,
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

/** 写入并 Fresh Validation 一份 Playwright 资产。 */
async function compileAsset(
  kind: 'conservative' | 'optimized',
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
  source: string,
): Promise<AssetRecord> {
  const file = kind === 'conservative' ? paths.conservative : paths.optimized;
  await writeFile(file, source, 'utf8');
  console.log(`\n[验证脚本] ${path.relative(process.cwd(), file)}`);
  const validation = await validateSpec(file);
  const record = manifest[kind];
  record.status = validation.status;
  record.validation = validation;
  await saveManifest(paths, manifest);
  console.log(`[验证结果] ${record.status}`);
  return record;
}

/** 创建 case，执行 Explore，并在同一次 Codex turn 中保存未验证草稿。 */
async function performExplore(caseId: string, instruction: string): Promise<void> {
  const paths = getCasePaths(caseId);
  await createCaseDirectories(paths);
  await writeFile(paths.instruction, `${instruction}\n`, 'utf8');
  const manifest = createManifest(caseId, instruction);
  await saveManifest(paths, manifest);

  try {
    console.log(`[创建并探索] ${caseId}`);
    console.log('[探索] 创建新的 Codex thread');
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
    printTrace(explored.items);
    console.log(`\n[探索结果]\n${explored.finalResponse}`);

    if (explored.status !== 'PASS') {
      throw new Error('Agent 探索未通过，未保存 Playwright 草稿。');
    }

    if (explored.draftSource) {
      await writeFile(paths.conservative, explored.draftSource, 'utf8');
      manifest.conservative.status = 'DRAFT';
      console.log(`\n[探索草稿] ${path.relative(process.cwd(), paths.conservative)}`);
    } else {
      console.log('\n[探索草稿] Codex 未返回草稿，将在收敛阶段补充生成。');
    }

    manifest.pipelineStatus = 'EXPLORED';
    manifest.pipelineError = null;
    await saveManifest(paths, manifest);
    console.log(`\n[探索完成] ${paths.directory}`);
  } catch (error) {
    manifest.pipelineStatus = 'FAILED';
    manifest.pipelineError = errorMessage(error);
    await saveManifest(paths, manifest);
    throw error;
  }
}

/** 从命令行文件读取 instruction 并执行独立 Explore 阶段。 */
async function exploreCommand(args: string[]): Promise<void> {
  const caseId = requiredOption(args, '--case');
  const instructionFile = path.resolve(requiredOption(args, '--instruction'));
  const instruction = (await readFile(instructionFile, 'utf8')).trim();
  if (!instruction) throw new Error('instruction 文件不能为空。');
  await performExplore(caseId, instruction);
}

/** 读取探索草稿；不存在时恢复原 thread 补充生成一个候选脚本。 */
async function readOrGenerateDraft(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<string> {
  try {
    return await readFile(paths.conservative, 'utf8');
  } catch {
    if (!manifest.threadId || !manifest.explore) {
      throw new Error('缺少 Explore thread 或 Trace，无法生成草稿。');
    }
    console.log('[生成草稿] Explore 未返回草稿，恢复原 Codex thread 补充生成。');
    const trace = JSON.parse(await readFile(paths.rawTrace, 'utf8')) as Parameters<
      typeof generateAsset
    >[3];
    const thread = resumeAgentThread(manifest.threadId);
    const source = await generateAsset(
      thread,
      'optimized',
      manifest.originalInstruction,
      trace,
    );
    await writeFile(paths.conservative, source, 'utf8');
    manifest.conservative.status = 'DRAFT';
    await saveManifest(paths, manifest);
    return source;
  }
}

/** 验证探索草稿，失败时仅允许一次 Codex Agentic Repair。 */
async function performConverge(caseId: string): Promise<void> {
  const paths = getCasePaths(caseId);
  const manifest = await readManifest(paths);
  if (manifest.explore?.status !== 'PASS' || !manifest.threadId) {
    throw new Error('只有探索成功的测试用例才能收敛脚本。');
  }

  manifest.pipelineStatus = 'CONVERGING';
  manifest.pipelineError = null;
  await saveManifest(paths, manifest);

  try {
    console.log(`[收敛脚本] ${caseId}`);
    const trace = JSON.parse(await readFile(paths.rawTrace, 'utf8')) as Parameters<
      typeof generateAsset
    >[3];
    let optimizedSource = await readOrGenerateDraft(paths, manifest);
    const optimized = await compileAsset(
      'optimized',
      paths,
      manifest,
      optimizedSource,
    );

    if (optimized.status === 'INVALID') {
      console.log('\n[修复脚本] Fresh Validation 失败，进行唯一一次 Agentic Repair');
      optimized.repaired = true;
      const failure = optimized.validation?.error ?? 'Playwright 未返回失败详情。';
      const repaired = await repairOptimized(
        manifest.threadId,
        manifest.originalInstruction,
        trace,
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

    if (manifest.optimized.status !== 'VALIDATED') {
      throw new Error('脚本经过一次修复后仍未通过 Fresh Validation。');
    }
    manifest.pipelineStatus = 'COMPLETED';
    manifest.pipelineError = null;
    await saveManifest(paths, manifest);
    console.log(`\n[收敛完成] ${paths.optimized}`);
  } catch (error) {
    manifest.pipelineStatus = 'FAILED';
    manifest.pipelineError = errorMessage(error);
    await saveManifest(paths, manifest);
    throw error;
  }
}

/** 执行独立的 Playwright 脚本收敛阶段。 */
async function convergeCommand(args: string[]): Promise<void> {
  await performConverge(requiredOption(args, '--case'));
}

/** 保留一键 Explore → Converge 命令，兼容原有自动化调用。 */
async function compileCommand(args: string[]): Promise<void> {
  const caseId = requiredOption(args, '--case');
  const instructionFile = path.resolve(requiredOption(args, '--instruction'));
  const instruction = (await readFile(instructionFile, 'utf8')).trim();
  if (!instruction) throw new Error('instruction 文件不能为空。');
  await performExplore(caseId, instruction);
  await performConverge(caseId);
}

/** 执行已经通过 Fresh Validation 的离线 Playwright 资产。 */
async function runReplay(
  mode: 'conservative' | 'optimized',
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<void> {
  const asset = manifest[mode];
  if (asset.status !== 'VALIDATED') {
    throw new Error(`${mode} 脚本当前为 ${asset.status}，不可执行且不会回退到 Agent。`);
  }
  console.log('[CODEX 调用次数] 0');
  const result = await validateSpec(path.join(paths.directory, asset.file));
  const status = result.status === 'VALIDATED' ? 'PASS' : 'FAIL';
  manifest.runs.push(
    runRecord(mode, status, result.durationMs, null, null, result.error),
  );
  await saveManifest(paths, manifest);
  console.log(`[零模型重放] ${status}`);
  if (status === 'FAIL') process.exitCode = 1;
}

/** 使用新的 Codex thread 重新执行已保存 instruction。 */
async function runAgent(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<void> {
  console.log('[Agent 探索] 创建新的 Codex thread');
  const explored = await explore(manifest.originalInstruction, false);
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
  console.log(`[Thread ID] ${explored.threadId}`);
  printTrace(explored.items);
  console.log(`\n[Agent 结果]\n${explored.finalResponse}`);
  if (explored.status === 'FAIL') process.exitCode = 1;
}

/** 根据 mode 分派零模型重放或新的 Agent 探索。 */
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

/** 输出 CLI 的最小用法。 */
function printUsage(): void {
  console.log(`用法：
  npm start -- explore --case <id> --instruction <file>
  npm start -- converge --case <id>
  npm start -- run --case <id> --mode <agent|conservative|optimized>
  npm start -- compile --case <id> --instruction <file>  # 兼容一键流程`);
}

/** 解析顶层命令并运行。 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'explore') return exploreCommand(args);
  if (command === 'converge') return convergeCommand(args);
  if (command === 'compile') return compileCommand(args);
  if (command === 'run') return runCommand(args);
  printUsage();
  if (command) throw new Error(`未知命令：${command}`);
}

main().catch((error: unknown) => {
  console.error(`错误：${errorMessage(error)}`);
  process.exitCode = 1;
});
