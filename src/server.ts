import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

import { getCasePaths, readManifest, type RunMode } from './core.js';

interface Job {
  id: string;
  caseId: string;
  action: 'explore' | 'converge' | RunMode;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4173);
const WEB_ROOT = path.resolve('web');
const RUNTIME_ROOT = path.resolve('.runtime');
const CLI = path.resolve('dist', 'index.js');
const jobs = new Map<string, Job>();

/** 向浏览器返回 JSON 响应。 */
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/** 读取大小受限的 JSON 请求体。 */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('请求内容过大。');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/** 校验并返回前端提交的 case ID。 */
function caseIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Case ID 只能包含字母、数字、短横线和下划线。');
  }
  return value;
}

/** 去除子进程输出中的 ANSI 控制字符。 */
function plainText(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/** 启动现有 CLI 子进程，并在内存中记录其进度。 */
function startJob(caseId: string, action: Job['action'], args: string[]): Job {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    caseId,
    action,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    output: '',
    exitCode: null,
  };
  jobs.set(id, job);

  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.FORCE_COLOR;
  delete environment.NO_COLOR;
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk: Buffer): void => {
    job.output = `${job.output}${plainText(chunk.toString('utf8'))}`.slice(-200_000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', (error) => {
    job.output += `\n${error.message}`;
    job.status = 'failed';
    job.exitCode = 1;
    job.finishedAt = new Date().toISOString();
  });
  child.once('close', (code) => {
    job.exitCode = code ?? 1;
    job.status = job.exitCode === 0 ? 'completed' : 'failed';
    job.finishedAt = new Date().toISOString();
  });
  return job;
}

/** 列出本地 cases 目录下可读取的 manifest 摘要。 */
async function listCases(): Promise<unknown[]> {
  let entries;
  try {
    entries = await readdir(path.resolve('cases'), { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const manifest = await readManifest(getCasePaths(entry.name));
          return {
            caseId: manifest.caseId,
            version: manifest.version,
            instruction: manifest.originalInstruction,
            pipelineStatus: manifest.pipelineStatus,
            updatedAt: manifest.updatedAt,
            draft: manifest.conservative.status,
            replay: manifest.optimized.status,
            lastRun: manifest.runs.at(-1) ?? null,
          };
        } catch {
          return null;
        }
      }),
  );
  return manifests
    .filter((manifest) => manifest !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** 读取一个 case 的 manifest、Trace、探索草稿和收敛脚本。 */
async function loadCase(caseId: string): Promise<unknown> {
  const paths = getCasePaths(caseId);
  const manifest = await readManifest(paths);
  const optional = async (file: string): Promise<string | null> => {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  };
  return {
    manifest,
    trace: JSON.parse((await optional(paths.rawTrace)) ?? '[]'),
    draftSource: await optional(paths.conservative),
    replaySource: await optional(paths.optimized),
  };
}

/** 接收自然语言文本并创建独立的 Agent 探索任务。 */
async function createExploreJob(body: Record<string, unknown>): Promise<Job> {
  const caseId = caseIdFrom(body.caseId);
  if (typeof body.instruction !== 'string' || !body.instruction.trim()) {
    throw new Error('测试用例不能为空。');
  }
  const paths = getCasePaths(caseId);
  try {
    await access(paths.directory);
    throw new Error(`Case ${caseId} 已存在，请使用新的 Case ID。`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Case ')) throw error;
  }

  await mkdir(RUNTIME_ROOT, { recursive: true });
  const instructionFile = path.join(RUNTIME_ROOT, `${caseId}-${Date.now()}.txt`);
  await writeFile(instructionFile, `${body.instruction.trim()}\n`, 'utf8');
  const job = startJob(caseId, 'explore', [
    'explore',
    '--case',
    caseId,
    '--instruction',
    instructionFile,
  ]);
  const timer = setInterval(() => {
    if (job.status === 'running') return;
    clearInterval(timer);
    void unlink(instructionFile).catch(() => undefined);
  }, 500);
  return job;
}

/** 为探索成功的 case 创建 Playwright 脚本收敛任务。 */
async function createConvergeJob(body: Record<string, unknown>): Promise<Job> {
  const caseId = caseIdFrom(body.caseId);
  await access(getCasePaths(caseId).manifest);
  return startJob(caseId, 'converge', ['converge', '--case', caseId]);
}

/** 为已有 case 创建 Replay 或 Agent 执行任务。 */
async function createRunJob(body: Record<string, unknown>): Promise<Job> {
  const caseId = caseIdFrom(body.caseId);
  if (!['agent', 'conservative', 'optimized'].includes(String(body.mode))) {
    throw new Error('运行模式无效。');
  }
  await access(getCasePaths(caseId).manifest);
  const mode = String(body.mode) as RunMode;
  return startJob(caseId, mode, ['run', '--case', caseId, '--mode', mode]);
}

/** 返回首页静态资源。 */
async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  };
  const resource = files[pathname];
  if (!resource) return json(response, 404, { error: 'Not found' });
  response.writeHead(200, { 'content-type': resource[1], 'cache-control': 'no-store' });
  response.end(await readFile(path.join(WEB_ROOT, resource[0])));
}

/** 路由本地页面与 JSON API。 */
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  if (request.method === 'GET' && url.pathname === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/cases') {
    return json(response, 200, await listCases());
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/cases/')) {
    const caseId = caseIdFrom(decodeURIComponent(url.pathname.slice('/api/cases/'.length)));
    return json(response, 200, await loadCase(caseId));
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const job = jobs.get(url.pathname.slice('/api/jobs/'.length));
    return job ? json(response, 200, job) : json(response, 404, { error: '任务不存在。' });
  }
  if (request.method === 'POST' && url.pathname === '/api/explore') {
    return json(response, 202, await createExploreJob(await readBody(request)));
  }
  if (request.method === 'POST' && url.pathname === '/api/converge') {
    return json(response, 202, await createConvergeJob(await readBody(request)));
  }
  if (request.method === 'POST' && url.pathname === '/api/run') {
    return json(response, 202, await createRunJob(await readBody(request)));
  }
  await serveStatic(url.pathname, response);
}

/** 启动仅允许本机访问的 Benchmark 控制台。 */
createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    json(response, 400, { error: message });
  });
}).listen(PORT, HOST, () => {
  console.log(`AI Web Test Agent V0：http://${HOST}:${PORT}`);
});
