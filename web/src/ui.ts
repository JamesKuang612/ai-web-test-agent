import type { AgentConfig } from './types';

export const MODEL_OPTIONS = [
  ['gpt-5.6-terra', '5.6 Terra（推荐）'],
  ['gpt-5.6-sol', '5.6 Sol'],
  ['gpt-5.6-luna', '5.6 Luna'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
  ['deepseek-v4-flash-vision-exp', 'DeepSeek V4 Flash Vision'],
] as const;
export const DEEPSEEK_MODELS = new Set<string>(MODEL_OPTIONS.slice(3).map(([value]) => value));
export const GPT_EFFORTS = [
  ['low', '低'],
  ['medium', '中（推荐）'],
  ['high', '高'],
  ['xhigh', '极高'],
  ['max', '最大'],
] as const;
export const DEEPSEEK_EFFORTS = [
  ['low', '低'],
  ['high', '高（推荐）'],
  ['max', '最大'],
] as const;

const STATUS_LABELS: Record<string, string> = {
  EXPLORING: '探索中',
  EXPLORED: '已探索',
  GENERATING_SCRIPT: '正在生成 Playwright 脚本',
  COMPLETED: '已完成',
  FAILED: '失败',
  PASS: '通过',
  FAIL: '未通过',
  PENDING: '待生成',
  DRAFT: '未验证',
  GENERATING: '生成中',
  VALIDATED: '已验证',
  INVALID: '验证失败',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已停止',
  ready: '就绪',
};

const ACTION_LABELS: Record<string, string> = {
  explore: '智能体探索',
  generate: '生成 Playwright 脚本',
  agent: '重新 Codex 探索',
  script: '零模型重放',
  conservative: '旧版忠实回放',
  optimized: '旧版收敛回放',
};

/** 将内部状态转换为中文。 */
export function statusLabel(value?: string | null): string {
  return value ? (STATUS_LABELS[value] ?? value) : '—';
}
/** 返回状态对应的颜色类。 */
export function statusClass(value = ''): string {
  const normalized = value.toLowerCase();
  if (['validated', 'completed', 'pass', 'explored'].includes(normalized)) return 'valid';
  if (['generating', 'generating_script', 'exploring', 'running'].includes(normalized)) return 'running';
  return normalized;
}
/** 将运行类型转换为中文。 */
export function actionLabel(value: string): string {
  return ACTION_LABELS[value] ?? value;
}
/** 将毫秒转换为紧凑耗时。 */
export function formatDuration(value?: number | null): string {
  if (!Number.isFinite(value)) return '—';
  return (value as number) < 1000 ? `${value} 毫秒` : `${((value as number) / 1000).toFixed(1)} 秒`;
}
/** 将模型配置转换为中文摘要。 */
export function configLabel(config?: AgentConfig | null): string {
  if (!config) return '旧资产，未记录';
  const model = MODEL_OPTIONS.find(([value]) => value === config.model)?.[1] ?? config.model;
  const effort =
    [...GPT_EFFORTS, ...DEEPSEEK_EFFORTS].find(([value]) => value === config.reasoningEffort)?.[1] ??
    config.reasoningEffort;
  return `${model} / ${effort}`;
}
/** 生成便于本地识别的默认用例 ID。 */
export function newCaseId(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join('');
  return `case-${stamp}`;
}
