# AI Web Test Agent V0

这个项目不重新实现 Web Agent。Codex 负责理解页面与决定操作，Playwright MCP 提供浏览器工具，V0 Runtime 只负责编排、事实 Trace、资产保存和 Fresh Validation。

核心流程：

```text
Explore → Compile → Validate → Replay
```

## 前提

- Node.js 22 或更高版本
- 本机 Codex 已通过 ChatGPT 登录
- 已执行 `npm install`
- Playwright 登录状态保存在 `playwright/.auth/jdy.json`

`playwright/.auth/` 是本地敏感目录，已经被 Git 忽略，不得提交其中的 storageState。

## Compile

```powershell
npm start -- compile --case <case-id> --instruction <instruction-file>
```

Compile 会依次执行：

1. 创建新的 Codex thread，通过 Playwright MCP 完成 Agent Explore。
2. 保存脱敏后的 Raw Exploration Trace。
3. 在同一 thread 中生成 `conservative.spec.ts` 并 Fresh Validation。
4. 生成 `optimized.spec.ts` 并 Fresh Validation。
5. Optimized Validation 失败时最多进行一次 Agentic Repair，再验证一次。

每个 case 保存在 `cases/<case-id>/`。只有状态为 `VALIDATED` 的离线资产才允许 Replay。

## Run

```powershell
npm start -- run --case <case-id> --mode conservative
npm start -- run --case <case-id> --mode optimized
npm start -- run --case <case-id> --mode agent
```

三种模式互相独立：

- `conservative`：执行已验证的 Conservative Playwright Test，不调用模型。
- `optimized`：执行已验证的 Optimized Playwright Test，不调用模型。
- `agent`：创建新的 Codex thread，让 Agent 重新面对当前网站执行 instruction。

离线资产不存在或状态不是 `VALIDATED` 时，Runtime 会拒绝执行，不会自动 fallback 到 Agent。

## 本地资产

```text
cases/<case-id>/
├── instruction.txt
├── manifest.json
├── raw-trace.json
├── conservative.spec.ts
├── optimized.spec.ts
└── runs/
```

`raw-trace.json` 只保存 MCP 调用顺序、server、tool、脱敏 arguments、status 和 error，不保存 snapshot/result 正文，也不读取 storageState 内容。
