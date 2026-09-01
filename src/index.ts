import { Codex } from '@openai/codex-sdk';

const MODEL = 'gpt-5.6-sol';
const REASONING_EFFORT = 'max';

/** 从命令行参数或标准输入读取一条自然语言测试指令。 */
async function readInstruction(): Promise<string> {
  const argument = process.argv.slice(2).join(' ').trim();
  if (argument) return argument;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const piped = Buffer.concat(chunks).toString('utf8').trim();
  if (piped) return piped;

  throw new Error('缺少测试指令，请通过命令行参数或标准输入提供。');
}

/** 使用 Codex Agent 和项目级 Playwright MCP 执行测试指令。 */
async function main(): Promise<void> {
  const instruction = await readInstruction();
  const thread = new Codex().startThread({
    workingDirectory: process.cwd(),
    model: MODEL,
    modelReasoningEffort: REASONING_EFFORT,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
  });
  const result = await thread.run(
    `${instruction}\n\n必须使用项目配置的 playwright MCP 浏览器工具执行任务。完成页面导航后，必须调用 browser_snapshot 获取页面证据，再根据实际页面内容给出 PASS 或 FAIL。`,
  );

  console.log(result.finalResponse);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`错误：${message}`);
  process.exitCode = 1;
});
