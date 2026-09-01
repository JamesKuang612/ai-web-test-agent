# AI Web Test Agent V0

最小 Agent-first AI Web Test prototype，当前仅验证 Explore。

技术链：`Codex SDK → GPT-5.6 Sol → Playwright MCP → Browser`

## 前提

- 已安装 Node.js 和 npm
- 本机 Codex 已通过 ChatGPT 登录，`codex login status` 应显示 `Logged in using ChatGPT`

## 安装与运行

```powershell
npm install
npm start -- "<natural language test instruction>"
```

也可以通过标准输入运行 benchmark：

```powershell
Get-Content -Raw benchmarks/example.txt | npm start
```

当前尚未实现 Generate、Replay 和 Heal。
