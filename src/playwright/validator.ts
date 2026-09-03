import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ValidationRecord } from '../domain/case.js';
import { sanitizeText } from '../shared/trace.js';

/** 递归查找 Playwright 最近生成的错误上下文。 */
async function findErrorContexts(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) return findErrorContexts(child);
        return entry.name === 'error-context.md' ? [child] : [];
      }),
    )
  ).flat();
}

/** 在独立进程中对生成的 Playwright 脚本做 Fresh Validation。 */
export async function validateSpec(specFile: string): Promise<ValidationRecord> {
  const startedAt = Date.now();
  const cli = path.resolve('node_modules', '@playwright', 'test', 'cli.js');
  const testFile = path.relative(process.cwd(), specFile).replaceAll('\\', '/');
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.FORCE_COLOR;
  delete environment.NO_COLOR;
  const child = spawn(
    process.execPath,
    [cli, 'test', testFile, '--headed', '--workers=1', '--reporter=line', '--timeout=30000', '--global-timeout=30000'],
    { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    process.stderr.write(chunk);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  let evidence = Buffer.concat(chunks).toString('utf8');
  if (exitCode !== 0) {
    const latest = (await findErrorContexts(path.resolve('test-results'))).at(-1);
    if (latest) evidence += `\n\n${await readFile(latest, 'utf8')}`;
  }
  return {
    status: exitCode === 0 ? 'VALIDATED' : 'INVALID',
    durationMs: Date.now() - startedAt,
    exitCode,
    runAt: new Date().toISOString(),
    error: exitCode === 0 ? null : sanitizeText(evidence).slice(0, 50_000),
  };
}
