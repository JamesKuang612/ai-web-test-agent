import path from 'node:path';

import { PlaywrightBrowserAgent } from '@midscene/web/playwright';
import { chromium } from 'playwright';

import { sanitizeText, type TraceEntry } from './trace.js';

export const MIDSCENE_MODEL = 'deepseek-v4-flash-vision-exp';
export const DEFAULT_MIDSCENE_STEP_LIMIT = 20;

export type MidsceneStatus = 'PASS' | 'FAIL';

export interface MidsceneExploreResult {
  status: MidsceneStatus;
  durationMs: number;
  finalResponse: string;
  reportFile: string | null;
  actions: number;
  modelCalls: number;
  modelTimeMs: number;
  error: string | null;
  trace: TraceEntry[];
}

/** 构造 Midscene 使用的 DeepSeek Vision 配置，并复用现有 DeepSeek 环境变量。 */
function midsceneModelConfig(): Record<string, string | number> {
  const apiKey = process.env.MIDSCENE_MODEL_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY 或 MIDSCENE_MODEL_API_KEY。');
  }
  return {
    MIDSCENE_MODEL_BASE_URL:
      process.env.MIDSCENE_MODEL_BASE_URL ??
      process.env.DEEPSEEK_BASE_URL ??
      'https://api.deepseek.com',
    MIDSCENE_MODEL_API_KEY: apiKey,
    MIDSCENE_MODEL_NAME: MIDSCENE_MODEL,
    MIDSCENE_MODEL_FAMILY: 'deepseek',
  };
}

/** 将 Midscene 的动作进度转换成与现有展示兼容的轻量 Trace。 */
function appendActionTrace(
  trace: TraceEntry[],
  phase: string,
  data: { action?: { name?: string; target?: string }; durationMs?: number; error?: string },
): void {
  if (!['action_done', 'action_failed'].includes(phase) || !data.action?.name) return;
  trace.push({
    sequence: trace.length + 1,
    server: 'midscene',
    tool: data.action.name,
    arguments: data.action.target ? { target: sanitizeText(data.action.target) } : {},
    status: phase === 'action_done' ? 'completed' : 'failed',
    error: data.error ? sanitizeText(data.error) : null,
  });
}

/** 在独立可见浏览器中按用户指定的规划周期上限运行 Midscene 快速探索。 */
export async function exploreWithMidscene(
  instruction: string,
  caseId: string,
  stepLimit: number,
): Promise<MidsceneExploreResult> {
  const startedAt = Date.now();
  const trace: TraceEntry[] = [];
  let status: MidsceneStatus = 'FAIL';
  let output = '';
  let error: string | null = null;
  let reportFile: string | null = null;
  let modelCalls = 0;
  let modelTimeMs = 0;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let agent: PlaywrightBrowserAgent | null = null;

  try {
    const modelConfig = midsceneModelConfig();
    const storageState = path.resolve('playwright', '.auth', 'jdy.json');
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    agent = new PlaywrightBrowserAgent(context, page, {
      autoFollowNewPage: true,
      generateReport: true,
      persistExecutionDump: false,
      reportFileName: `fast-${caseId}-${Date.now()}`,
      modelConfig,
      replanningCycleLimit: stepLimit,
    });
    agent.addProgressListener((event) => {
      if (event.scope !== 'aiAct') return;
      const data = event.data as {
        planIndex?: number;
        planLimit?: number;
        action?: { name?: string; target?: string };
        durationMs?: number;
        error?: string;
      };
      if (event.phase === 'plan_thinking') {
        console.log(
          `[Midscene 规划] ${data.planIndex ?? trace.length + 1}/${data.planLimit ?? '—'}`,
        );
      }
      if (event.phase === 'action_running' && data.action?.name) {
        const target = data.action.target ? ` → ${sanitizeText(data.action.target)}` : '';
        console.log(`[Midscene 操作] ${data.action.name}${target}`);
      }
      appendActionTrace(trace, event.phase, data);
    });

    output =
      (await agent.aiAct(`${instruction}

请完整执行以上测试用例，并验证其中要求的最终结果。只有在所有要求都已实际满足时才结束；无法确认时必须失败，不要猜测。`, {
        deepThink: false,
        deepLocate: false,
      })) ?? '';
    status = 'PASS';
  } catch (caught) {
    status = 'FAIL';
    error = sanitizeText(caught instanceof Error ? caught.message : String(caught));
  } finally {
    if (agent) {
      await agent.destroy().catch(() => undefined);
      reportFile = agent.reportFile
        ? path.relative(process.cwd(), agent.reportFile).replaceAll('\\', '/')
        : null;
      modelCalls = agent.metrics.calls;
      modelTimeMs = agent.metrics.totalTimeCostMs;
    }
    await browser?.close().catch(() => undefined);
  }

  const durationMs = Date.now() - startedAt;
  const finalResponse =
    status === 'PASS'
      ? `PASS\nMidscene 已完成并确认测试用例。${output ? `\n${sanitizeText(output)}` : ''}`
      : `${status}\nMidscene 快速探索未完成：${error ?? '未知原因'}`;
  return {
    status,
    durationMs,
    finalResponse,
    reportFile,
    actions: trace.length,
    modelCalls,
    modelTimeMs,
    error,
    trace,
  };
}
