import {
  AGENT_MODELS,
  type AgentConfig,
  type AgentModel,
  DEEPSEEK_REASONING_EFFORTS,
  DEFAULT_AGENT_CONFIG,
  GPT_REASONING_EFFORTS,
  type ReasoningEffort,
} from '../domain/case.js';

const DEEPSEEK_MODELS = new Set<AgentModel>(['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']);

/** 判断模型是否通过 DeepSeek Provider 调用。 */
export function isDeepSeekModel(model: AgentModel): boolean {
  return DEEPSEEK_MODELS.has(model);
}

/** 返回指定模型支持的推理强度。 */
export function reasoningEffortsFor(model: AgentModel): readonly ReasoningEffort[] {
  return isDeepSeekModel(model) ? DEEPSEEK_REASONING_EFFORTS : GPT_REASONING_EFFORTS;
}

/** 校验来自 CLI 或 API 的模型配置，禁止静默降级。 */
export function parseAgentConfig(model?: string | null, effort?: string | null): AgentConfig {
  const selectedModel = model ?? DEFAULT_AGENT_CONFIG.model;
  const selectedEffort = effort ?? DEFAULT_AGENT_CONFIG.reasoningEffort;
  if (!AGENT_MODELS.includes(selectedModel as AgentModel)) {
    throw new Error(`不支持的模型：${selectedModel}。`);
  }
  const supported = reasoningEffortsFor(selectedModel as AgentModel);
  if (!supported.includes(selectedEffort as ReasoningEffort)) {
    throw new Error(`模型 ${selectedModel} 不支持推理强度 ${selectedEffort}，可选：${supported.join('、')}。`);
  }
  return { model: selectedModel as AgentModel, reasoningEffort: selectedEffort as ReasoningEffort };
}
