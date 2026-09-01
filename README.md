# AI Web Test Agent V0

用于验证以下最短链路的 CLI 项目：

`自然语言测试指令 → OpenAI Agents SDK → Playwright MCP → 浏览器`

Agent 负责页面理解、元素选择、浏览器操作、失败恢复和最终验证。V0 暂不实现 Generate、Replay、Run、Heal、自定义浏览器工具封装或页面特定 Runtime。

## 环境要求

- Node.js 22 或更高版本
- 能够访问配置模型的 OpenAI API Key

## 运行

```powershell
npm install
Copy-Item .env.example .env
# 编辑 .env 并设置 OPENAI_API_KEY。
npm start -- "访问 https://example.com，并验证页面中存在 Example Domain 标题。"
```

也可以通过标准输入管道读取 benchmark 指令：

```powershell
Get-Content -Raw benchmarks/example.txt | npm start
```

默认模型为 `gpt-5.6-sol`，可以通过 `OPENAI_MODEL` 覆盖。设置 `PLAYWRIGHT_MCP_HEADLESS=true` 可启用无头模式。MCP 浏览器会话采用隔离模式，并在运行结束后销毁。

## 验证项目

```powershell
npm run typecheck
npm run build
```

CLI 启动时会连接本地安装的官方 Playwright MCP 服务，并打印它提供的工具名称。MCP 服务会直接交给 Agents SDK，由 SDK 管理 Agent 和工具调用循环。
