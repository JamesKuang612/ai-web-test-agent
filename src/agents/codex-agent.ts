import path from 'node:path';

import { Codex, type RunResult, type Thread } from '@openai/codex-sdk';

import { isDeepSeekModel } from '../config/agent-config.js';
import type { AgentConfig, ExploreResult } from '../domain/case.js';
import { extractTrace } from '../shared/trace.js';

/** 返回 Windows 沙箱能够注册能力 SID 的最小可写目录。 */
export function writableRootFor(writableFile: string): string {
  return path.dirname(path.resolve(writableFile)).replaceAll('\\', '/');
}

/** 根据模型与可写文件范围创建 Codex SDK 客户端。 */
function createCodex(config: AgentConfig, writableFile?: string): Codex {
  const providerConfig = isDeepSeekModel(config.model)
    ? {
        model_provider: 'deepseek',
        model_providers: {
          deepseek: {
            name: 'DeepSeek',
            base_url: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
            env_key: 'DEEPSEEK_API_KEY',
            wire_api: 'responses',
          },
        },
      }
    : {};
  if (!writableFile) return new Codex({ config: providerConfig });
  const target = writableRootFor(writableFile);
  return new Codex({
    config: providerConfig,
    configOverrides: [
      'default_permissions="script_generation"',
      `permissions.script_generation.filesystem={":workspace_roots"="read","${target}"="write"}`,
    ],
  });
}

/** 判断 Codex 是否给出了明确的通过结论。 */
function isPass(response: string): boolean {
  return /^\s*(?:\*\*)?PASS(?:\*\*)?(?![A-Z0-9_])/i.test(response);
}

/** 封装 Codex 的自主探索与脚本生成能力。 */
export class CodexAgent {
  /** 创建新会话并通过 Playwright MCP 执行自然语言测试。 */
  async explore(instruction: string, config: AgentConfig): Promise<ExploreResult> {
    const startedAt = Date.now();
    const thread = createCodex(config).startThread({
      workingDirectory: process.cwd(),
      model: config.model,
      modelReasoningEffort: config.reasoningEffort,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    });
    const turn = await thread.run(`${instruction}

必须使用项目配置的 playwright MCP 浏览器工具执行任务。请只专注于完成本次测试，自主观察、操作、恢复和验证；不要生成 Playwright 脚本。完成后必须调用 browser_snapshot 获取最终页面证据，并以 PASS 或 FAIL 开头给出结论。`);
    if (!thread.id) throw new Error('Codex 未返回 thread ID。');
    return {
      threadId: thread.id,
      items: turn.items,
      trace: extractTrace(turn.items),
      finalResponse: turn.finalResponse.trim(),
      status: isPass(turn.finalResponse) ? 'PASS' : 'FAIL',
      durationMs: Date.now() - startedAt,
      agentConfig: config,
    };
  }

  /** 恢复既有会话，并可将写权限限制在单个脚本文件。 */
  resume(threadId: string, config: AgentConfig, writableFile?: string): Thread {
    return createCodex(config, writableFile).resumeThread(threadId, {
      workingDirectory: process.cwd(),
      model: config.model,
      modelReasoningEffort: config.reasoningEffort,
      approvalPolicy: 'never',
    });
  }

  /** 恢复探索会话并生成唯一的 Playwright 脚本。 */
  async generateScript(threadId: string, scriptFile: string, config: AgentConfig): Promise<RunResult> {
    const thread = this.resume(threadId, config, scriptFile);
    const relativeFile = path.relative(process.cwd(), scriptFile).replaceAll('\\', '/');
    return thread.run(`你已经在当前 thread 中成功完成过这个测试。

请以之前成功执行的路径为主要依据，不要重新发明业务路线。现在重新打开目标页面，仅使用项目配置的 Playwright MCP 做必要的定向校准：确认当前 URL、页面状态、关键控件、locator 层级，以及必要的 focus、dialog 或 navigation 状态转换。不要重复发布、删除、安装等明显有副作用的业务动作，也不要为了探索而遍历无关页面。

校准完成后，将这条已验证路径写成可靠、可重复执行的标准 Playwright Test，保存到 ${relativeFile}。你只能创建或修改这个目标 spec 文件，不得修改 manifest、instruction、Trace、其他 case 或任何 Runtime 文件。不要运行 Playwright 测试命令；脚本生成后立即结束，Runtime 会使用独立的 30 秒 Fresh Validation 执行一次。完成后简要说明结果。`);
  }
}
