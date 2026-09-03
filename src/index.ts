import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  agentConfig,
  createCaseDirectories,
  createManifest,
  explore,
  generateScript,
  getCasePaths,
  getScriptPath,
  readManifest,
  saveManifest,
  validateSpec,
  writeJson,
  type AssetRecord,
  type AgentConfig,
  type CaseManifest,
  type RunMode,
  type RunRecord,
} from './core.js';
import { printTrace } from './trace.js';

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
  config: AgentConfig | null = null,
): RunRecord {
  return {
    mode,
    status,
    durationMs,
    runAt: new Date().toISOString(),
    threadId,
    traceFile,
    error,
    agentConfig: config,
  };
}

/** 从命令行选项读取并校验本次 Codex 模型配置。 */
function configFrom(args: string[]): AgentConfig {
  return agentConfig(option(args, '--model'), option(args, '--reasoning'));
}

/** 对 Codex 已经写入的脚本执行独立 Fresh Validation。 */
async function validateGeneratedScript(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
  config: AgentConfig,
): Promise<AssetRecord> {
  const file = getScriptPath(paths, manifest);
  const source = await readFile(file, 'utf8');
  if (!source.trim()) throw new Error('Codex 生成的 Playwright 脚本为空。');
  console.log(`\n[验证脚本] ${path.relative(process.cwd(), file)}`);
  const validation = await validateSpec(file);
  const record = manifest.script;
  record.agentConfig = config;
  record.status = validation.status;
  record.validation = validation;
  await saveManifest(paths, manifest);
  console.log(`[验证结果] ${record.status}`);
  return record;
}

/** 创建 case，并让 Codex 只执行浏览器探索和结果判断。 */
async function performExplore(
  caseId: string,
  instruction: string,
  config: AgentConfig,
): Promise<void> {
  const paths = getCasePaths(caseId);
  await createCaseDirectories(paths);
  await writeFile(paths.instruction, `${instruction}\n`, 'utf8');
  const manifest = createManifest(caseId, instruction);
  await saveManifest(paths, manifest);

  try {
    console.log(`[创建并探索] ${caseId}`);
    console.log(`[模型配置] ${config.model} / ${config.reasoningEffort}`);
    console.log('[探索] 创建新的 Codex thread');
    const explored = await explore(instruction, config);
    await writeJson(paths.rawTrace, explored.trace);
    manifest.threadId = explored.threadId;
    manifest.explore = {
      status: explored.status,
      durationMs: explored.durationMs,
      finalResponse: explored.finalResponse,
      traceFile: 'raw-trace.json',
      mcpCalls: explored.trace.length,
      agentConfig: config,
    };
    printTrace(explored.items);
    console.log(`\n[探索结果]\n${explored.finalResponse}`);

    if (explored.status !== 'PASS') {
      throw new Error('Agent 探索未通过，未进入脚本生成阶段。');
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
  await performExplore(caseId, instruction, configFrom(args));
}

/** 恢复原探索会话，让 Codex 自主产出并验证唯一的 Playwright 脚本。 */
async function performGenerate(caseId: string, config: AgentConfig): Promise<void> {
  const paths = getCasePaths(caseId);
  const manifest = await readManifest(paths);
  if (manifest.explore?.status !== 'PASS' || !manifest.threadId) {
    throw new Error('只有探索成功的测试用例才能生成 Playwright 脚本。');
  }

  manifest.version = 4;
  manifest.script = {
    file: 'playwright.spec.ts',
    status: 'GENERATING',
    agentConfig: config,
    validation: null,
  };
  manifest.pipelineStatus = 'GENERATING_SCRIPT';
  manifest.pipelineError = null;
  await saveManifest(paths, manifest);

  try {
    console.log(`[生成 Playwright 脚本] ${caseId}`);
    console.log(`[恢复 Codex 会话] ${manifest.threadId}`);
    console.log(`[模型配置] ${config.model} / ${config.reasoningEffort}`);
    console.log('[生成方式] 原 Codex 会话定向校准后只写入目标 spec，由 Runtime 独立验证');
    const turn = await generateScript(manifest.threadId, paths.script, config);
    printTrace(turn.items);
    console.log(`\n[Codex 生成结果]\n${turn.finalResponse.trim()}`);

    const script = await validateGeneratedScript(paths, manifest, config);
    if (script.status !== 'VALIDATED') {
      throw new Error('Codex 生成的脚本未通过独立 Fresh Validation。');
    }

    manifest.pipelineStatus = 'COMPLETED';
    manifest.pipelineError = null;
    await saveManifest(paths, manifest);
    console.log(`\n[Playwright 脚本完成] ${paths.script}`);
  } catch (error) {
    if (manifest.script.status === 'GENERATING') manifest.script.status = 'INVALID';
    manifest.pipelineStatus = 'FAILED';
    manifest.pipelineError = errorMessage(error);
    await saveManifest(paths, manifest);
    throw error;
  }
}

/** 执行独立的 Playwright 脚本生成阶段。 */
async function generateCommand(args: string[]): Promise<void> {
  await performGenerate(requiredOption(args, '--case'), configFrom(args));
}

/** 执行已经通过 Fresh Validation 的离线 Playwright 资产。 */
async function runReplay(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
): Promise<void> {
  const asset = manifest.script;
  if (asset.status !== 'VALIDATED') {
    throw new Error(`Playwright 脚本当前为 ${asset.status}，不可执行且不会回退到 Agent。`);
  }
  console.log('[CODEX 调用次数] 0');
  const result = await validateSpec(getScriptPath(paths, manifest));
  const status = result.status === 'VALIDATED' ? 'PASS' : 'FAIL';
  manifest.runs.push(
    runRecord('script', status, result.durationMs, null, null, result.error),
  );
  await saveManifest(paths, manifest);
  console.log(`[零模型重放] ${status}`);
  if (status === 'FAIL') process.exitCode = 1;
}

/** 使用新的 Codex thread 重新执行已保存 instruction。 */
async function runAgent(
  paths: ReturnType<typeof getCasePaths>,
  manifest: CaseManifest,
  config: AgentConfig,
): Promise<void> {
  console.log('[Agent 探索] 创建新的 Codex thread');
  console.log(`[模型配置] ${config.model} / ${config.reasoningEffort}`);
  const explored = await explore(manifest.originalInstruction, config);
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
      config,
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
  if (!['agent', 'script'].includes(requestedMode)) {
    throw new Error('--mode 必须是 agent 或 script。');
  }
  const mode = requestedMode as RunMode;
  const paths = getCasePaths(caseId);
  const manifest = await readManifest(paths);
  if (mode === 'agent') await runAgent(paths, manifest, configFrom(args));
  else await runReplay(paths, manifest);
}

/** 输出 CLI 的最小用法。 */
function printUsage(): void {
  console.log(`用法：
  npm start -- explore --case <id> --instruction <file> [--model <model>] [--reasoning <level>]
  npm start -- generate --case <id> [--model <model>] [--reasoning <level>]
  npm start -- run --case <id> --mode <agent|script>`);
}

/** 解析顶层命令并运行。 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'explore') return exploreCommand(args);
  if (command === 'generate') return generateCommand(args);
  if (command === 'run') return runCommand(args);
  printUsage();
  if (command) throw new Error(`未知命令：${command}`);
}

main().catch((error: unknown) => {
  console.error(`错误：${errorMessage(error)}`);
  process.exitCode = 1;
});
