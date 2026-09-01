import { Agent, type MCPServerStdio } from '@openai/agents';

/** 创建一个直接使用 Playwright MCP 工具的自主 Web 测试 Agent。 */
export function createWebTestAgent(
  playwright: MCPServerStdio,
  model: string,
): Agent {
  return new Agent({
    name: 'AI Web 测试 Agent',
    model,
    instructions: `你是一个自主执行 Web 测试的 Agent。

使用 Playwright MCP 提供的浏览器工具完成用户给出的自然语言测试指令。你需要自行观察页面、选择并执行浏览器操作；遇到普通的交互失败时，应尝试其他合理策略恢复；最后必须根据页面中的实际状态验证用户要求的结果。

不能仅仅因为某个操作执行完成就宣称测试成功。任务结束时，报告 PASS 或 FAIL、观察到的相关证据以及简洁说明。不得编造证据。`,
    mcpServers: [playwright],
  });
}
