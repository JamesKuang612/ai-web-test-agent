import { DEFAULT_MIDSCENE_STEP_LIMIT } from '../agents/midscene-agent.js';
import { parseAgentConfig } from '../config/agent-config.js';
import type { AgentConfig, ExploreStrategy } from '../domain/case.js';

/** 返回指定 CLI 选项后面的值。 */
export function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/** 读取必填 CLI 选项。 */
export function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`缺少必填参数 ${name}。`);
  return value;
}

/** 读取并校验 Codex 模型配置。 */
export function agentConfigFrom(args: string[]): AgentConfig {
  return parseAgentConfig(option(args, '--model'), option(args, '--reasoning'));
}

/** 读取并校验探索方式。 */
export function strategyFrom(args: string[]): ExploreStrategy {
  const strategy = option(args, '--strategy') ?? 'codex-only';
  if (!['codex-only', 'midscene-only'].includes(strategy)) {
    throw new Error('--strategy 必须是 codex-only 或 midscene-only。');
  }
  return strategy as ExploreStrategy;
}

/** 读取并校验 Midscene Step 上限。 */
export function stepLimitFrom(args: string[]): number {
  const raw = option(args, '--steps');
  const value = raw === null ? DEFAULT_MIDSCENE_STEP_LIMIT : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('--steps 必须是 1 到 100 之间的整数。');
  }
  return value;
}
