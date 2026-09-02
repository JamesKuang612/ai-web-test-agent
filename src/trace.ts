import { type McpToolCallItem, type ThreadItem } from '@openai/codex-sdk';

export interface TraceEntry {
  sequence: number;
  server: string;
  tool: string;
  arguments: unknown;
  status: string;
  error: string | null;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_NAME =
  /password|passwd|pwd|token|access.?token|refresh.?token|authorization|cookie|secret|api.?key|密码|账号|账户|用户名|登录名|邮箱|email|手机号|手机号码/i;

/** 对自由文本中的邮箱和显式凭据片段进行保守脱敏。 */
export function sanitizeText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, REDACTED)
    .replace(
      /(password|passwd|pwd|token|access.?token|refresh.?token|authorization|cookie|secret|api.?key|密码|账号|账户|用户名|登录名)\s*[:=：]\s*\S+/gi,
      `$1: ${REDACTED}`,
    );
}

/** 判断一个未知值是否为可递归处理的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 递归复制 MCP 参数，并根据字段名与输入控件描述隐藏凭据。 */
function sanitizeValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_NAME.test(key)) return REDACTED;
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!isRecord(value)) return value;

  const credentialInput = ['label', 'name', 'type', 'placeholder', 'element'].some(
    (field) => typeof value[field] === 'string' && SENSITIVE_NAME.test(value[field]),
  );

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      credentialInput && /^(value|text)$/i.test(childKey)
        ? REDACTED
        : sanitizeValue(childValue, childKey),
    ]),
  );
}

/** 为终端输出额外隐藏单字段输入工具中的全部文本。 */
function sanitizeForTerminal(item: McpToolCallItem): unknown {
  const sanitized = sanitizeValue(item.arguments);
  if (item.tool !== 'browser_type' || !isRecord(sanitized)) return sanitized;
  return { ...sanitized, text: REDACTED };
}

/** 从完整 Turn 中按原顺序提取可持久化的脱敏 MCP 事实 Trace。 */
export function extractTrace(items: readonly ThreadItem[]): TraceEntry[] {
  return items
    .filter((item): item is McpToolCallItem => item.type === 'mcp_tool_call')
    .map((item, index) => ({
      sequence: index + 1,
      server: item.server,
      tool: item.tool,
      arguments: sanitizeValue(item.arguments),
      status: item.status,
      error: item.error ? sanitizeText(item.error.message) : null,
    }));
}

/** 以比持久化 Trace 更保守的规则输出本次 MCP 调用。 */
export function printTrace(items: readonly ThreadItem[]): void {
  const toolCalls = items.filter(
    (item): item is McpToolCallItem => item.type === 'mcp_tool_call',
  );

  toolCalls.forEach((item, index) => {
    console.log(`\n[TRACE #${index + 1}]`);
    console.log(`server: ${item.server}`);
    console.log(`tool: ${item.tool}`);
    console.log(`status: ${item.status}`);
    console.log(`arguments: ${JSON.stringify(sanitizeForTerminal(item), null, 2)}`);
    if (item.error) console.log(`error: ${sanitizeText(item.error.message)}`);
  });
}
