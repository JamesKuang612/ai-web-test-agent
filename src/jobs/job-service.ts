import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CaseService } from '../application/case-service.js';

export type JobAction = 'explore' | 'generate' | 'agent' | 'script';
export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  caseId: string;
  action: JobAction;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
}

interface ActiveJob {
  record: Job;
  child: ChildProcess;
}

/** 执行 CLI 子进程，并将任务状态持久化到本地运行目录。 */
export class JobService {
  private readonly jobs = new Map<string, Job>();
  private readonly active = new Map<string, ActiveJob>();
  private readonly writes = new Map<string, Promise<void>>();

  constructor(
    private readonly caseService = new CaseService(),
    private readonly root = path.resolve('.runtime', 'jobs'),
    private readonly cli = path.resolve('dist', 'cli', 'main.js'),
  ) {}

  /** 加载历史任务，并把服务重启时仍在运行的任务标记为中断。 */
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(await readFile(path.join(this.root, entry.name), 'utf8')) as Job;
        if (job.status === 'running') {
          job.status = 'failed';
          job.finishedAt = new Date().toISOString();
          job.output += '\n任务因服务停止而中断。';
          await this.persist(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        // 单个损坏的历史任务不能阻止服务启动。
      }
    }
  }

  /** 启动一个独立 CLI 任务并持续收集输出。 */
  async start(caseId: string, action: JobAction, args: string[], temporaryFiles: string[] = []): Promise<Job> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: Job = {
      id,
      caseId,
      action,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      output: '',
      exitCode: null,
    };
    const environment: NodeJS.ProcessEnv = { ...process.env };
    delete environment.FORCE_COLOR;
    delete environment.NO_COLOR;
    const child = spawn(process.execPath, [this.cli, ...args], {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.jobs.set(id, record);
    this.active.set(id, { record, child });
    await this.persist(record);

    const append = (chunk: Buffer): void => {
      record.output = `${record.output}${this.plainText(chunk.toString('utf8'))}`.slice(-200_000);
      void this.persist(record);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (error) => {
      if (record.status !== 'running') return;
      record.output += `\n${error.message}`;
      void this.finish(record, 'failed', 1, temporaryFiles);
    });
    child.once('close', (code) => {
      if (record.status !== 'running') return;
      void this.finish(record, code === 0 ? 'completed' : 'failed', code ?? 1, temporaryFiles);
    });
    return record;
  }

  /** 返回内存中的最新任务状态。 */
  get(jobId: string): Job | null {
    return this.jobs.get(jobId) ?? null;
  }

  /** 取消仍在运行的任务，并同步修复用例状态。 */
  async cancel(jobId: string): Promise<Job> {
    const active = this.active.get(jobId);
    if (active?.record.status !== 'running') {
      throw new Error('任务不存在或已经结束。');
    }
    active.record.status = 'cancelled';
    active.record.exitCode = null;
    active.record.finishedAt = new Date().toISOString();
    active.record.output += '\n任务已由用户终止。';
    active.child.kill('SIGTERM');
    this.active.delete(jobId);
    await this.persist(active.record);
    await this.caseService.markInterrupted(active.record.caseId, '任务已由用户终止。').catch(() => undefined);
    return active.record;
  }

  /** 删除一次性 instruction 文件。 */
  async removeTemporaryInstruction(file: string): Promise<void> {
    await unlink(file).catch(() => undefined);
  }

  /** 将任务收敛到终态并持久化。 */
  private async finish(
    record: Job,
    status: Exclude<JobStatus, 'running'>,
    exitCode: number,
    temporaryFiles: string[],
  ): Promise<void> {
    record.status = status;
    record.exitCode = exitCode;
    record.finishedAt = new Date().toISOString();
    this.active.delete(record.id);
    await this.persist(record);
    await Promise.all(temporaryFiles.map((file) => this.removeTemporaryInstruction(file)));
  }

  /** 原子持久化任务快照。 */
  private async persist(job: Job): Promise<void> {
    const file = path.join(this.root, `${job.id}.json`);
    const contents = `${JSON.stringify(job, null, 2)}\n`;
    const previous = this.writes.get(job.id) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(temporary, contents, 'utf8');
        await rename(temporary, file);
      });
    this.writes.set(job.id, current);
    try {
      await current;
    } finally {
      if (this.writes.get(job.id) === current) this.writes.delete(job.id);
    }
  }

  /** 去除子进程输出中的 ANSI 控制字符。 */
  private plainText(value: string): string {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 控制序列必须从 ESC 字符开始匹配。
    return value.replace(/\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  }
}
