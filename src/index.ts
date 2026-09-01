import { MCPServerStdio, run } from '@openai/agents';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createWebTestAgent } from './agent.js';

const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_MAX_TURNS = 50;

/** 从命令行参数或标准输入中读取一条自然语言测试指令。 */
async function readInstruction(): Promise<string> {
  const argument = process.argv.slice(2).join(' ').trim();
  if (argument) return argument;

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const piped = Buffer.concat(chunks).toString('utf8').trim();
    if (piped) return piped;
  }

  throw new Error(
    '缺少测试指令，请通过命令行参数传入或从标准输入管道提供。',
  );
}

/** 读取并校验单次 Agent 运行允许的最大回合数。 */
function readMaxTurns(): number {
  const value = Number.parseInt(
    process.env.AI_WEB_TEST_MAX_TURNS ?? String(DEFAULT_MAX_TURNS),
    10,
  );
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('AI_WEB_TEST_MAX_TURNS 必须是正整数。');
  }
  return value;
}

/** 创建通过当前 Node.js 进程启动的本地 Playwright MCP stdio 服务。 */
function createPlaywrightMcpServer(): MCPServerStdio {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('@playwright/mcp/package.json');
  const cli = resolve(dirname(packageJson), 'cli.js');

  return new MCPServerStdio({
    name: 'Playwright MCP',
    command: process.execPath,
    args: [cli, '--isolated'],
    cwd: process.cwd(),
    timeout: 60_000,
  });
}

/** 连接 Playwright MCP、运行 Agent，并在结束时释放浏览器服务。 */
async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      '未设置 OPENAI_API_KEY，请将 .env.example 复制为 .env 并填写有效密钥。',
    );
  }

  const instruction = await readInstruction();
  const playwright = createPlaywrightMcpServer();

  await playwright.connect();
  try {
    const tools = await playwright.listTools();
    console.error(
      `已连接 Playwright MCP（${tools.length} 个工具）：${tools
        .map((tool) => tool.name)
        .join(', ')}`,
    );

    const agent = createWebTestAgent(
      playwright,
      process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
    );
    const result = await run(agent, instruction, {
      maxTurns: readMaxTurns(),
    });

    console.log(result.finalOutput);
  } finally {
    await playwright.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`错误：${message}`);
  process.exitCode = 1;
});
