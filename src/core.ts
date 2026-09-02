import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Codex, type Thread, type ThreadItem } from '@openai/codex-sdk';

import { extractTrace, sanitizeText, type TraceEntry } from './trace.js';

export type AssetStatus = 'PENDING' | 'DRAFT' | 'VALIDATED' | 'INVALID';
export type RunMode = 'agent' | 'conservative' | 'optimized';
export type PipelineStatus =
  | 'EXPLORING'
  | 'EXPLORED'
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
  validation: ValidationRecord | null;
  repaired: boolean;
  repairMcpCalls: number;
  repairTraceFile: string | null;
}

export interface RunRecord {
  mode: RunMode;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  runAt: string;
  threadId: string | null;
  traceFile: string | null;
  error: string | null;
}

export interface CaseManifest {
  version: 1 | 2;
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
  } | null;
  conservative: AssetRecord;
  optimized: AssetRecord;
  runs: RunRecord[];
}

export interface CasePaths {
  directory: string;
  instruction: string;
  manifest: string;
  rawTrace: string;
  conservative: string;
  optimized: string;
  runs: string;
}

export interface ExploreResult {
  thread: Thread;
  threadId: string;
  items: ThreadItem[];
  trace: TraceEntry[];
  finalResponse: string;
  draftSource: string | null;
  status: 'PASS' | 'FAIL';
  durationMs: number;
}

const MODEL = 'gpt-5.6-sol';
const REASONING_EFFORT = 'max';
const AUTH_STATE = 'playwright/.auth/jdy.json';

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
    conservative: path.join(directory, 'conservative.spec.ts'),
    optimized: path.join(directory, 'optimized.spec.ts'),
    runs: path.join(directory, 'runs'),
  };
}

/** 创建一份尚未执行的最小 case manifest。 */
export function createManifest(caseId: string, instruction: string): CaseManifest {
  const now = new Date().toISOString();
  const asset = (file: string): AssetRecord => ({
    file,
    status: 'PENDING',
    validation: null,
    repaired: false,
    repairMcpCalls: 0,
    repairTraceFile: null,
  });
  return {
    version: 2,
    caseId,
    originalInstruction: instruction,
    createdAt: now,
    updatedAt: now,
    pipelineStatus: 'EXPLORING',
    pipelineError: null,
    threadId: null,
    explore: null,
    conservative: asset('conservative.spec.ts'),
    optimized: asset('optimized.spec.ts'),
    runs: [],
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
  return JSON.parse(await readFile(paths.manifest, 'utf8')) as CaseManifest;
}

/** 判断 Codex 最终答复是否以明确的 PASS 开始。 */
function isPass(response: string): boolean {
  return /^\s*(?:\*\*)?PASS(?:\*\*)?(?![A-Z0-9_])/i.test(response);
}

/** 从 Explore 最终答复中分离测试结论与未验证 Playwright 草稿。 */
function parseExploreResponse(response: string): {
  finalResponse: string;
  draftSource: string | null;
} {
  const result = response.match(/\[RESULT\]\s*([\s\S]*?)\s*\[\/RESULT\]/i)?.[1]?.trim();
  const draft = response
    .match(/\[DRAFT_PLAYWRIGHT\]\s*([\s\S]*?)\s*\[\/DRAFT_PLAYWRIGHT\]/i)?.[1]
    ?.trim();
  return {
    finalResponse: result || response.trim(),
    draftSource: draft ? normalizeSource(draft) : null,
  };
}

/** 创建新的 Codex thread，并使用 Playwright MCP 执行自然语言测试。 */
export async function explore(
  instruction: string,
  includeDraft = true,
): Promise<ExploreResult> {
  const startedAt = Date.now();
  const thread = new Codex().startThread({
    workingDirectory: process.cwd(),
    model: MODEL,
    modelReasoningEffort: REASONING_EFFORT,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });
  const draftRequirement = includeDraft
    ? `

如果测试 PASS，请利用本次探索中已经获得的页面上下文，同时给出一份尚未验证的标准 @playwright/test TypeScript 草稿。草稿必须使用新的 browser context，通过 test.use 加载 ${AUTH_STATE}，使用本机 chrome channel，优先使用稳定 Playwright locator，不得使用 MCP 临时 ref 或 arbitrary sleep。不要为了生成草稿重新操作页面。

最终答复严格使用以下格式：
[RESULT]
PASS 或 FAIL 开头的测试结论
[/RESULT]
[DRAFT_PLAYWRIGHT]
PASS 时填写完整 TypeScript 源码；FAIL 时留空
[/DRAFT_PLAYWRIGHT]`
    : '\n\n最终答复必须以 PASS 或 FAIL 开头给出结论。';
  const turn = await thread.run(`${instruction}

必须使用项目配置的 playwright MCP 浏览器工具执行任务。请自主观察、操作、恢复和验证；完成后必须调用 browser_snapshot 获取最终页面证据。${draftRequirement}`);
  const threadId = thread.id;
  if (!threadId) throw new Error('Codex 未返回 thread ID。');
  const parsed = parseExploreResponse(turn.finalResponse);
  return {
    thread,
    threadId,
    items: turn.items,
    trace: extractTrace(turn.items),
    finalResponse: parsed.finalResponse,
    draftSource: parsed.draftSource,
    status: isPass(parsed.finalResponse) ? 'PASS' : 'FAIL',
    durationMs: Date.now() - startedAt,
  };
}

/** 恢复已保存的 Codex thread，以便稍后生成或修复 Playwright 脚本。 */
export function resumeAgentThread(threadId: string): Thread {
  return new Codex().resumeThread(threadId, {
    workingDirectory: process.cwd(),
    model: MODEL,
    modelReasoningEffort: REASONING_EFFORT,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });
}

/** 去掉模型偶尔附加的单层 Markdown 代码围栏。 */
function normalizeSource(response: string): string {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:typescript|ts)?\s*\n([\s\S]*?)\n```$/i);
  return `${fenced?.[1] ?? trimmed}\n`;
}

/** 在原 Explore thread 中编译 Conservative 或 Optimized Playwright 资产。 */
export async function generateAsset(
  thread: Thread,
  kind: 'conservative' | 'optimized',
  instruction: string,
  trace: TraceEntry[],
): Promise<string> {
  const shared = `
原始 instruction：
--- INSTRUCTION START ---
${instruction}
--- INSTRUCTION END ---

成功 Explore 的已脱敏 Raw Trace：
--- TRACE START ---
${JSON.stringify(trace, null, 2)}
--- TRACE END ---

输出完整合法的标准 @playwright/test TypeScript source。使用新的 browser context，通过 test.use 加载 ${AUTH_STATE}，并使用本机 chrome channel。必须使用稳定 Playwright locator 和 web-first assertions，不得使用 MCP 临时 ref，不得使用 arbitrary sleep。只返回源码，不要 Markdown 代码块，不要解释，也不要直接写文件。`;
  const conservative = `这是 Conservative Compilation，不追求最短路径。
尽可能忠实保留成功 Explore 中真正影响成功的必要状态转换、Recovery、focus/blur、键盘操作、弹窗处理、页面切换、条件判断和最终验证。
只删除纯 snapshot、纯观察 find、无副作用 evaluate、明显重复观察、MCP 临时 ref 和无意义日志。
把临时 target/ref 转换为 getByRole、getByLabel、getByPlaceholder、getByText、getByTestId 等标准 locator，必要时才使用 CSS。
目标是 faithful、replayable、deterministic。`;
  const optimized = `这是 Optimized Compilation。请根据原始业务目标、成功 Explore 经验和当前 thread 上下文，生成 minimal reliable Playwright Test。
可以删除探索噪音和无意义 Recovery、选择更直接路线与更稳定 locator，并在明显需要时参数化一次性测试数据。
必须保留原始业务语义、instruction 明确要求的条件分支和必要状态转换；不能因为本次只走了一个分支就丢掉另一个分支。`;
  const turn = await thread.run(`${kind === 'conservative' ? conservative : optimized}\n${shared}`);
  return normalizeSource(turn.finalResponse);
}

/** 允许 Codex 自主决定是否实时观察页面，并仅修复一次 Optimized 资产。 */
export async function repairOptimized(
  threadId: string,
  instruction: string,
  trace: TraceEntry[],
  source: string,
  failureEvidence: string,
): Promise<{ source: string; items: ThreadItem[] }> {
  const thread = resumeAgentThread(threadId);
  const turn = await thread.run(`Optimized Candidate 的 Fresh Playwright Validation 失败。请只修复一次，并返回完整 optimized.spec.ts 源码。

原始 instruction：
${instruction}

已脱敏 Raw Exploration Trace：
${JSON.stringify(trace, null, 2)}

失败 Candidate：
--- SOURCE START ---
${source}
--- SOURCE END ---

真实 Playwright failure evidence：
--- FAILURE START ---
${failureEvidence}
--- FAILURE END ---

请自行判断现有证据是否足够；如果不够，可以使用项目配置的 Playwright MCP 重新进入真实页面调查。不要改变原始业务语义，不要使用 MCP 临时 ref 或 arbitrary sleep，并继续加载 ${AUTH_STATE}。只返回完整合法 TypeScript source，不要 Markdown 代码块，不要解释，也不要直接写文件。`);
  return { source: normalizeSource(turn.finalResponse), items: turn.items };
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
    [playwrightCli, 'test', testFile, '--headed', '--workers=1', '--reporter=line'],
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
