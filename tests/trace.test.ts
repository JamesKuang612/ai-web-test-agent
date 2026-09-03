import type { ThreadItem } from '@openai/codex-sdk';
import { describe, expect, it } from 'vitest';

import { extractTrace, sanitizeText } from '../src/shared/trace.js';

describe('Trace 脱敏', () => {
  it('隐藏邮箱和显式密码', () => {
    expect(sanitizeText('账号: user@example.com 密码: hello')).not.toContain('user@example.com');
    expect(sanitizeText('password=hello')).toContain('[REDACTED]');
  });

  it('保留 MCP 顺序并隐藏密码字段值', () => {
    const items = [
      {
        type: 'mcp_tool_call',
        server: 'playwright',
        tool: 'browser_fill_form',
        status: 'completed',
        arguments: { fields: [{ name: '登录密码', type: 'textbox', value: 'secret-value' }] },
      },
      { type: 'agent_message', text: 'done' },
    ] as unknown as ThreadItem[];
    const trace = extractTrace(items);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.sequence).toBe(1);
    expect(JSON.stringify(trace[0]?.arguments)).not.toContain('secret-value');
  });
});
