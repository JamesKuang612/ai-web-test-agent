import { describe, expect, it } from 'vitest';

import { parseAgentConfig, reasoningEffortsFor } from '../src/config/agent-config.js';

describe('模型配置', () => {
  it('默认使用 Terra medium', () => {
    expect(parseAgentConfig()).toEqual({ model: 'gpt-5.6-terra', reasoningEffort: 'medium' });
  });

  it('拒绝模型不支持的推理强度', () => {
    expect(() => parseAgentConfig('deepseek-v4-flash', 'medium')).toThrow('不支持推理强度');
  });

  it('按模型返回推理强度集合', () => {
    expect(reasoningEffortsFor('gpt-5.6-sol')).toContain('medium');
    expect(reasoningEffortsFor('deepseek-v4-pro')).toEqual(['low', 'high', 'max']);
  });
});
