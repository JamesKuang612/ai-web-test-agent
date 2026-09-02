# AI Web Test Agent V0

这个项目不重新实现 Web 智能体。Codex 负责理解页面与决定操作，Playwright MCP 提供浏览器工具，V0 运行时只负责编排、事实轨迹、资产保存和独立验证。

核心流程已经拆成可以独立触发的三个阶段：

```text
智能体探索 + 未验证草稿 → 脚本收敛 → 零模型重放
```

## 前提

- Node.js 22 或更高版本
- 本机 Codex 已通过 ChatGPT 登录
- 已执行 `npm install`
- Playwright 登录状态保存在 `playwright/.auth/jdy.json`

`playwright/.auth/` 是本地敏感目录，已经被 Git 忽略，不得提交其中的 storageState。

## 智能体探索

```powershell
npm start -- explore --case <case-id> --instruction <instruction-file>
```

一次智能体探索会：

1. 创建新的 Codex 会话，通过 Playwright MCP 完成真实页面测试。
2. 保存脱敏后的 MCP 工具轨迹。
3. 在同一次 Codex 轮次的最终答复中顺便生成未验证 Playwright 草稿。
4. 保存结果与 `conservative.spec.ts` 草稿后立即结束，不自动进入耗时的收敛阶段。

## 脚本收敛

```powershell
npm start -- converge --case <case-id>
```

收敛阶段会先把探索草稿作为 `optimized.spec.ts` 执行独立验证。草稿直接通过时不调用模型；失败时恢复原 Codex 会话，最多进行一次智能体修复，再验证一次。

兼容的一键命令仍然保留：

```powershell
npm start -- compile --case <case-id> --instruction <instruction-file>
```

每个 case 保存在 `cases/<case-id>/`。只有状态为 `VALIDATED` 的收敛脚本才允许零模型重放。

## 执行

```powershell
npm start -- run --case <case-id> --mode conservative
npm start -- run --case <case-id> --mode optimized
npm start -- run --case <case-id> --mode agent
```

三种模式互相独立，其中 `conservative` 保留用于兼容已有 V0 用例：

- `optimized`：执行已经验证的收敛 Playwright 脚本，不调用模型。
- `agent`：创建新的 Codex 会话，让智能体重新面对当前网站执行自然语言用例。
- `conservative`：执行旧用例中已经验证的忠实 Playwright 脚本，不调用模型。

脚本不存在或状态不是 `VALIDATED` 时，Runtime 会拒绝执行，不会自动回退到 Agent。

## 本地资产

```text
cases/<case-id>/
├── instruction.txt
├── manifest.json
├── raw-trace.json                 # 脱敏后的 MCP 工具轨迹
├── conservative.spec.ts           # 探索阶段生成的未验证草稿
├── optimized.spec.ts              # 通过收敛验证的重放脚本
└── runs/
```

`raw-trace.json` 只保存 MCP 调用顺序、服务、工具、脱敏参数、状态和错误，不保存 snapshot/result 正文，也不读取 storageState 内容。

## 本地页面

```powershell
npm run web
```

然后打开 `http://127.0.0.1:4173`。页面提供：

- 独立的测试用例列表页与详情页；
- 从右上角创建测试用例并单独启动智能体探索；
- 探索通过后按需点击“收敛 Playwright 脚本”；
- 查看本地保存的结果、MCP 工具轨迹和两阶段 Playwright 源码；
- 零模型重放已验证的收敛脚本；
- 创建新的 Codex 会话重新执行智能体探索；
- 查看当前任务输出与历史运行结果。

页面只监听本机地址。它没有数据库，仍然以 `cases/` 中的 JSON、文本和 `.spec.ts` 文件作为唯一数据源。
