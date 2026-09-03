# AI Web Test Agent V0

这个项目不重新实现 Web 智能体。Codex 负责理解页面、决定操作以及生成测试脚本，Playwright MCP 提供浏览器工具，V0 运行时只负责任务入口、本地资产、展示用轨迹和最终独立验证。

核心流程只有两个由用户独立触发的阶段：

```text
自然语言测试用例
→ Codex + Playwright MCP 自主探索
→ 保存原 Codex thread ID、结论和展示用 Trace
→ 用户点击生成
→ 恢复原 Codex thread
→ Codex 定向校准后只写入目标 Playwright Test
→ 独立 Fresh Validation
→ 零模型重复执行
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

一次智能体探索会创建新的 Codex 会话，通过 Playwright MCP 完成真实页面测试，保存 PASS/FAIL 结论和脱敏后的 MCP 工具轨迹，然后立即结束。探索阶段不会生成 Playwright 脚本。

## 生成 Playwright 脚本

```powershell
npm start -- generate --case <case-id>
```

探索通过后，生成阶段使用保存的 thread ID 恢复同一个 Codex 会话。运行时不会把原始测试用例或 `raw-trace.json` 重新注入模型，也不会替 Codex 编排操作步骤。Codex 会基于原会话上下文做定向校准，并且只能写入目标 `playwright.spec.ts`；完成后，运行时执行唯一一次 30 秒独立 Fresh Validation。

只有状态为 `VALIDATED` 的脚本才允许零模型重放：

```powershell
npm start -- run --case <case-id> --mode script
```

也可以创建新的 Codex 会话重新执行原始自然语言用例：

```powershell
npm start -- run --case <case-id> --mode agent
```

脚本不存在或未通过验证时，运行时会拒绝重放，不会自动回退到 Agent。

## 模型配置

所有会调用 Codex 的命令都支持：

```powershell
--model <gpt-5.6-terra|gpt-5.6-sol|gpt-5.6-luna|deepseek-v4-flash|deepseek-v4-pro|deepseek-v4-flash-vision-exp>
--reasoning <low|medium|high|xhigh|max>（GPT）或 <low|high|max>（DeepSeek）
```

默认配置为 `gpt-5.6-terra + medium`。GPT 支持五档推理强度，DeepSeek 支持 `low/high/max` 三档；前端会根据模型动态展示选项。每次实际使用的配置都会保存到 `manifest.json`；无效值会直接报错，不会静默切换模型。

DeepSeek 模型通过 Codex custom model provider 使用 Responses API。运行 DeepSeek 模型前，请在当前进程环境中设置 `DEEPSEEK_API_KEY`；密钥不会写入项目文件。可选模型包括 `deepseek-v4-flash`、`deepseek-v4-pro` 和 `deepseek-v4-flash-vision-exp`。

## 本地资产

```text
cases/<case-id>/
├── instruction.txt
├── manifest.json
├── raw-trace.json          # 仅供展示和排障，不作为生成输入
├── playwright.spec.ts      # 通过独立验证后可零模型执行
└── runs/
```

`raw-trace.json` 只保存 MCP 调用顺序、服务、工具、脱敏参数、状态和错误，不保存 snapshot/result 正文，也不读取 storageState 内容。旧版 case 中的 `conservative.spec.ts` 和 `optimized.spec.ts` 会继续作为历史资产读取，但新流程不会再生成它们。

## 本地页面

```powershell
npm run web
```

然后打开 `http://127.0.0.1:4173`。页面提供：

- 创建自然语言测试用例并选择模型；
- 查看探索结论、Codex 会话和 MCP 工具轨迹；
- 恢复原 Codex 会话生成唯一的 Playwright 脚本；
- 查看脚本及其 Fresh Validation 状态；
- 零模型重复执行已验证脚本；
- 创建新 Codex 会话重新探索；
- 查看当前任务输出与历史运行结果。

页面只监听本机地址。它没有数据库，以 `cases/` 中的 JSON、文本和 `.spec.ts` 文件作为唯一数据源。
