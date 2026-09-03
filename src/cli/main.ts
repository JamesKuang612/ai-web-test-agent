import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CaseService } from '../application/case-service.js';
import { agentConfigFrom, requiredOption, stepLimitFrom, strategyFrom } from './args.js';

const service = new CaseService();

/** 输出 CLI 的稳定用法。 */
function printUsage(): void {
  console.log(`用法：
  npm start -- explore --case <id> --instruction <file> [--strategy <codex-only|midscene-only>] [--steps <1-100>] [--model <model>] [--reasoning <level>]
  npm start -- generate --case <id> [--model <model>] [--reasoning <level>]
  npm start -- run --case <id> --mode <agent|script> [--model <model>] [--reasoning <level>]`);
}

/** 分派顶层 CLI 命令。 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'explore') {
    const instruction = (await readFile(path.resolve(requiredOption(args, '--instruction')), 'utf8')).trim();
    if (!instruction) throw new Error('测试用例文件不能为空。');
    return service.explore({
      caseId: requiredOption(args, '--case'),
      instruction,
      config: agentConfigFrom(args),
      strategy: strategyFrom(args),
      stepLimit: stepLimitFrom(args),
    });
  }
  if (command === 'generate') {
    return service.generate(requiredOption(args, '--case'), agentConfigFrom(args));
  }
  if (command === 'run') {
    const mode = requiredOption(args, '--mode');
    if (mode !== 'agent' && mode !== 'script') throw new Error('--mode 必须是 agent 或 script。');
    return service.run(requiredOption(args, '--case'), mode, agentConfigFrom(args));
  }
  printUsage();
  if (command) throw new Error(`未知命令：${command}`);
}

main().catch((error: unknown) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
