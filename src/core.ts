import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Codex, type RunResult, type Thread, type ThreadItem } from '@openai/codex-sdk';

import { extractTrace, sanitizeText, type TraceEntry } from './trace.js';

export const AGENT_MODELS = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
] as const;
const DEEPSEEK_MODELS = new Set<AgentModel>([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
]);
export const GPT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEEPSEEK_REASONING_EFFORTS = ['low', 'high', 'max'] as const;
export const REASONING_EFFORTS = GPT_REASONING_EFFORTS;

export type AgentModel = (typeof AGENT_MODELS)[number];
export type ReasoningEffort =
  | (typeof GPT_REASONING_EFFORTS)[number]
  | (typeof DEEPSEEK_REASONING_EFFORTS)[number];
export interface AgentConfig {
  model: AgentModel;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: 'gpt-5.6-terra',
  reasoningEffort: 'medium',
};

export type AssetStatus = 'PENDING' | 'DRAFT' | 'GENERATING' | 'VALIDATED' | 'INVALID';
export type RunMode = 'agent' | 'script' | 'conservative' | 'optimized';
export type ExploreStrategy = 'codex-only' | 'midscene-only';
export type ExploreEngine = 'codex' | 'midscene';
export type PipelineStatus =
  | 'EXPLORING'
  | 'EXPLORED'
  | 'GENERATING_SCRIPT'
  | 'GENERATING_FAITHFUL'
  | 'FAITHFUL_READY'
  | 'GENERATING_OPTIMIZED'
  | 'CONVERGING'
  | 'COMPILING'
  | 'COMPLETED'
  | 'FAILED';

export interface ValidationRecord {
  status: Extract<AssetStatus, 'VALIDATED' | 'INVALID'>;
  durationMs: number;
  exitCode: number;
  runAt: string;
  error: string | null;
}

export interface AssetRecord {
  file: string;
  status: AssetStatus;
  agentConfig: AgentConfig | null;
  validation: ValidationRecord | null;
}

export interface RunRecord {
  mode: RunMode;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  runAt: string;
  threadId: string | null;
  traceFile: string | null;
  error: string | null;
  agentConfig: AgentConfig | null;
}

export interface CaseManifest {
  version: 1 | 2 | 3 | 4 | 5;
  caseId: string;
  originalInstruction: string;
  createdAt: string;
  updatedAt: string;
  pipelineStatus: PipelineStatus;
  pipelineError: string | null;
  threadId: string | null;
  explore: {
    status: 'PASS' | 'FAIL';
    durationMs: number;
    finalResponse: string;
    traceFile: string;
    mcpCalls: number;
    agentConfig?: AgentConfig | null;
    engine?: ExploreEngine;
    strategy?: ExploreStrategy;
    fastPath?: {
      status: 'PASS' | 'FAIL';
      durationMs: number;
      model: string;
      stepLimit?: number;
      reportFile: string | null;
      actions: number;
      modelCalls: number;
      modelTimeMs: number;
      error: string | null;
    } | null;
  } | null;
  script: AssetRecord;
  conservative?: AssetRecord;
  optimized?: AssetRecord;
  runs: RunRecord[];
}

export interface CasePaths {
  directory: string;
  instruction: string;
  manifest: string;
  rawTrace: string;
  script: string;
  conservative: string;
  optimized: string;
  runs: string;
}

export interface ExploreResult {
  threadId: string;
  items: ThreadItem[];
  trace: TraceEntry[];
  finalResponse: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  agentConfig: AgentConfig;
}

/** 返回指定模型实际支持的推理强度档位。 */
export function reasoningEffortsFor(model: AgentModel): readonly ReasoningEffort[] {
  return DEEPSEEK_MODELS.has(model) ? DEEPSEEK_REASONING_EFFORTS : GPT_REASONING_EFFORTS;
}

/** 校验来自 CLI 或前端的模型配置，避免无效值和静默降级。 */
export function agentConfig(model?: string | null, effort?: string | null): AgentConfig {
  const selectedModel = model ?? DEFAULT_AGENT_CONFIG.model;
  const selectedEffort = effort ?? DEFAULT_AGENT_CONFIG.reasoningEffort;
  if (!AGENT_MODELS.includes(selectedModel as AgentModel)) {
    throw new Error(`不支持的模型：${selectedModel}。`);
  }
  const supportedEfforts = reasoningEffortsFor(selectedModel as AgentModel);
  if (!supportedEfforts.includes(selectedEffort as ReasoningEffort)) {
    throw new Error(
      `模型 ${selectedModel} 不支持推理强度 ${selectedEffort}，可选：${supportedEfforts.join('、')}。`,
    );
  }
  return {
    model: selectedModel as AgentModel,
    reasoningEffort: selectedEffort as ReasoningEffort,
  };
}

/** 校验 case ID 并返回其本地资产路径。 */
export function getCasePaths(caseId: string): CasePaths {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(caseId)) {
    throw new Error('case ID 只能包含字母、数字、短横线和下划线。');
  }
  const directory = path.resolve('cases', caseId);
  return {
    directory,
    instruction: path.join(directory, 'instruction.txt'),
    manifest: path.join(directory, 'manifest.json'),
    rawTrace: path.join(directory, 'raw-trace.json'),
    script: path.join(directory, 'playwright.spec.ts'),
    conservative: path.join(directory, 'conservative.spec.ts'),
    optimized: path.join(directory, 'optimized.spec.ts'),
    runs: path.join(directory, 'runs'),
  };
}

/** 创建一份尚未执行的最小 case manifest。 */
export function createManifest(caseId: string, instruction: string): CaseManifest {
  const now = new Date().toISOString();
  return {
    version: 5,
    caseId,
    originalInstruction: instruction,
    createdAt: now,
    updatedAt: now,
    pipelineStatus: 'EXPLORING',
    pipelineError: null,
    threadId: null,
    explore: null,
    script: createAssetRecord('playwright.spec.ts'),
    runs: [],
  };
}

/** 创建一条尚未生成的 Playwright 脚本资产记录。 */
function createAssetRecord(file: string): AssetRecord {
  return {
    file,
    status: 'PENDING',
    agentConfig: null,
    validation: null,
  };
}

/** 将 JSON 数据以稳定缩进写入本地文件。 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** 保存 manifest 并刷新更新时间。 */
export async function saveManifest(paths: CasePaths, manifest: CaseManifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString();
  await writeJson(paths.manifest, manifest);
}

/** 读取一个已经编译或正在编译的 case manifest。 */
export async function readManifest(paths: CasePaths): Promise<CaseManifest> {
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8')) as CaseManifest;
  const legacyAsset =
    manifest.optimized?.status === 'VALIDATED'
      ? manifest.optimized
      : manifest.conservative?.status === 'VALIDATED'
        ? manifest.conservative
        : null;
  manifest.script ??= legacyAsset
    ? { ...legacyAsset }
    : createAssetRecord('playwright.spec.ts');
  manifest.script.agentConfig ??= null;
  for (const run of manifest.runs) run.agentConfig ??= null;
  return manifest;
}

/** 安全解析 manifest 中记录的脚本文件，防止路径逃出当前 case。 */
export function getScriptPath(paths: CasePaths, manifest: CaseManifest): string {
  const file = path.resolve(paths.directory, manifest.script.file);
  const prefix = `${paths.directory}${path.sep}`;
  if (!file.startsWith(prefix)) throw new Error('Playwright 脚本路径无效。');
  return file;
}

/** 判断 Codex 最终答复是否以明确的 PASS 开始。 */
function isPass(response: string): boolean {
  return /^\s*(?:\*\*)?PASS(?:\*\*)?(?![A-Z0-9_])/i.test(response);
}

/** 创建新的 Codex thread，并使用 Playwright MCP 执行自然语言测试。 */
export async function explore(instruction: string, config: AgentConfig): Promise<ExploreResult> {
  const startedAt = Date.now();
  const thread = createCodex(config).startThread({
    workingDirectory: process.cwd(),
    model: config.model,
    modelReasoningEffort: config.reasoningEffort,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });
  const turn = await thread.run(`${instruction}

必须使用项目配置的 playwright MCP 浏览器工具执行任务。请只专注于完成本次测试，自主观察、操作、恢复和验证；不要生成 Playwright 脚本。完成后必须调用 browser_snapshot 获取最终页面证据，并以 PASS 或 FAIL 开头给出结论。`);
  const threadId = thread.id;
  if (!threadId) throw new Error('Codex 未返回 thread ID。');
  return {
    threadId,
    items: turn.items,
    trace: extractTrace(turn.items),
    finalResponse: turn.finalResponse.trim(),
    status: isPass(turn.finalResponse) ? 'PASS' : 'FAIL',
    durationMs: Date.now() - startedAt,
    agentConfig: config,
  };
}

/** 恢复已保存的 Codex thread；生成阶段可将写权限限制到单个目标文件。 */
export function resumeAgentThread(
  threadId: string,
  config: AgentConfig,
  writableFile?: string,
): Thread {
  const codex = createCodex(config, writableFile);
  return codex.resumeThread(threadId, {
    workingDirectory: process.cwd(),
    model: config.model,
    modelReasoningEffort: config.reasoningEffort,
    approvalPolicy: 'never',
  });
}

/** 恢复原探索会话，让 Codex 定向校准后生成唯一的 Playwright 脚本。 */
export async function generateScript(
  threadId: string,
  scriptFile: string,
  config: AgentConfig,
): Promise<RunResult> {
  const thread = resumeAgentThread(threadId, config, scriptFile);
  const relativeFile = path.relative(process.cwd(), scriptFile).replaceAll('\\', '/');
  return thread.run(`你已经在当前 thread 中成功完成过这个测试。

请以之前成功执行的路径为主要依据，不要重新发明业务路线。现在重新打开目标页面，仅使用项目配置的 Playwright MCP 做必要的定向校准：确认当前 URL、页面状态、关键控件、locator 层级，以及必要的 focus、dialog 或 navigation 状态转换。不要重复发布、删除、安装等明显有副作用的业务动作，也不要为了探索而遍历无关页面。

校准完成后，将这条已验证路径写成可靠、可重复执行的标准 Playwright Test，保存到 ${relativeFile}。你只能创建或修改这个目标 spec 文件，不得修改 manifest、instruction、Trace、其他 case 或任何 Runtime 文件。不要运行 Playwright 测试命令；脚本生成后立即结束，Runtime 会使用独立的 30 秒 Fresh Validation 执行一次。完成后简要说明结果。`);
}

/** 根据模型选择 Codex Provider；DeepSeek 使用官方 Responses API 配置。 */
function createCodex(config: AgentConfig, writableFile?: string): Codex {
  const codexConfig = DEEPSEEK_MODELS.has(config.model)
    ? {
      model_provider: 'deepseek',
      model_providers: {
        deepseek: {
          name: 'DeepSeek',
          base_url: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
          env_key: 'DEEPSEEK_API_KEY',
          wire_api: 'responses',
        },
      },
    }
    : {};
  if (!writableFile) return new Codex({ config: codexConfig });

  const target = path.resolve(writableFile).replaceAll('\\', '/');
  return new Codex({
    config: codexConfig,
    configOverrides: [
      'default_permissions="script_generation"',
      `permissions.script_generation.filesystem={":workspace_roots"="read","${target}"="write"}`,
    ],
  });
}

/** 递归寻找 Playwright 最近一次生成的 error-context.md。 */
async function findErrorContexts(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) return findErrorContexts(child);
      return entry.name === 'error-context.md' ? [child] : [];
    }),
  );
  return nested.flat();
}

/** 使用独立 Playwright 进程 Fresh Validation 一份标准 spec。 */
export async function validateSpec(specFile: string): Promise<ValidationRecord> {
  const startedAt = Date.now();
  const playwrightCli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
  const testFile = path.relative(process.cwd(), specFile).replaceAll('\\', '/');
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
  delete childEnvironment.FORCE_COLOR;
  delete childEnvironment.NO_COLOR;
  const child = spawn(
    process.execPath,
    [
      playwrightCli,
      'test',
      testFile,
      '--headed',
      '--workers=1',
      '--reporter=line',
      '--timeout=30000',
      '--global-timeout=30000',
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  let evidence = Buffer.concat(chunks).toString('utf8');
  if (exitCode !== 0) {
    const contexts = await findErrorContexts(path.resolve('test-results'));
    const latest = contexts.at(-1);
    if (latest) evidence += `\n\n${await readFile(latest, 'utf8')}`;
  }
  return {
    status: exitCode === 0 ? 'VALIDATED' : 'INVALID',
    durationMs: Date.now() - startedAt,
    exitCode,
    runAt: new Date().toISOString(),
    error: exitCode === 0 ? null : sanitizeText(evidence).slice(0, 50_000),
  };
}

/** 确保 case 与运行记录目录已经存在。 */
export async function createCaseDirectories(paths: CasePaths): Promise<void> {
  await mkdir(path.dirname(paths.directory), { recursive: true });
  await mkdir(paths.directory);
  await mkdir(paths.runs);
}
