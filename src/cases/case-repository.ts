import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type CaseManifest, type CasePaths, createAssetRecord } from '../domain/case.js';
import type { TraceEntry } from '../shared/trace.js';

export interface CaseSummary {
  caseId: string;
  version: CaseManifest['version'];
  instruction: string;
  pipelineStatus: CaseManifest['pipelineStatus'];
  updatedAt: string;
  script: CaseManifest['script']['status'];
  exploreEngine: 'codex' | 'midscene';
  exploreDurationMs: number | null;
  fastPathStatus: 'PASS' | 'FAIL' | null;
  lastRun: CaseManifest['runs'][number] | null;
}

export interface CaseDetail {
  manifest: CaseManifest;
  trace: TraceEntry[];
  scriptSource: string | null;
  midsceneReportUrl: string | null;
}

/** 以本地目录作为唯一数据源读写测试用例资产。 */
export class CaseRepository {
  constructor(private readonly root = path.resolve('cases')) {}

  /** 校验用例 ID 并返回该用例的所有固定路径。 */
  paths(caseId: string): CasePaths {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(caseId)) {
      throw new Error('用例 ID 只能包含字母、数字、短横线和下划线。');
    }
    const directory = path.join(this.root, caseId);
    return {
      directory,
      instruction: path.join(directory, 'instruction.txt'),
      manifest: path.join(directory, 'manifest.json'),
      rawTrace: path.join(directory, 'raw-trace.json'),
      script: path.join(directory, 'playwright.spec.ts'),
      conservative: path.join(directory, 'conservative.spec.ts'),
      optimized: path.join(directory, 'optimized.spec.ts'),
      runs: path.join(directory, 'runs'),
    };
  }

  /** 创建互不覆盖的用例及运行记录目录。 */
  async createDirectories(paths: CasePaths): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(paths.directory);
    await mkdir(paths.runs);
  }

  /** 原子写入 JSON，避免进程中断留下半份 manifest。 */
  async writeJson(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, file);
  }

  /** 保存自然语言测试用例。 */
  async writeInstruction(paths: CasePaths, instruction: string): Promise<void> {
    await writeFile(paths.instruction, `${instruction}\n`, 'utf8');
  }

  /** 保存脱敏后的探索轨迹。 */
  async writeTrace(file: string, trace: TraceEntry[]): Promise<void> {
    await this.writeJson(file, trace);
  }

  /** 保存 manifest 并刷新更新时间。 */
  async save(paths: CasePaths, manifest: CaseManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await this.writeJson(paths.manifest, manifest);
  }

  /** 读取并兼容旧版用例资产。 */
  async read(paths: CasePaths): Promise<CaseManifest> {
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8')) as CaseManifest;
    const legacyAsset =
      manifest.optimized?.status === 'VALIDATED'
        ? manifest.optimized
        : manifest.conservative?.status === 'VALIDATED'
          ? manifest.conservative
          : null;
    manifest.script ??= legacyAsset ? { ...legacyAsset } : createAssetRecord();
    manifest.script.agentConfig ??= null;
    manifest.runs ??= [];
    for (const run of manifest.runs) run.agentConfig ??= null;
    return manifest;
  }

  /** 安全解析 manifest 中的脚本路径。 */
  scriptPath(paths: CasePaths, manifest: CaseManifest): string {
    const file = path.resolve(paths.directory, manifest.script.file);
    if (!file.startsWith(`${paths.directory}${path.sep}`)) {
      throw new Error('Playwright 脚本路径无效。');
    }
    return file;
  }

  /** 返回可选文本文件，不存在时返回 null。 */
  async optionalText(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8');
    } catch {
      return null;
    }
  }

  /** 列出本地所有可读取用例的摘要。 */
  async list(): Promise<CaseSummary[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            const manifest = await this.read(this.paths(entry.name));
            return {
              caseId: manifest.caseId,
              version: manifest.version,
              instruction: manifest.originalInstruction,
              pipelineStatus: manifest.pipelineStatus,
              updatedAt: manifest.updatedAt,
              script: manifest.script.status,
              exploreEngine: manifest.explore?.engine ?? 'codex',
              exploreDurationMs: manifest.explore?.durationMs ?? null,
              fastPathStatus: manifest.explore?.fastPath?.status ?? null,
              lastRun: manifest.runs.at(-1) ?? null,
            } satisfies CaseSummary;
          } catch {
            return null;
          }
        }),
    );
    return summaries
      .filter((summary): summary is CaseSummary => summary !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** 读取前端详情页需要的全部轻量资产。 */
  async detail(caseId: string): Promise<CaseDetail> {
    const paths = this.paths(caseId);
    const manifest = await this.read(paths);
    const traceText = await this.optionalText(paths.rawTrace);
    return {
      manifest,
      trace: traceText ? (JSON.parse(traceText) as TraceEntry[]) : [],
      scriptSource: await this.optionalText(this.scriptPath(paths, manifest)),
      midsceneReportUrl: manifest.explore?.fastPath?.reportFile
        ? `/api/cases/${encodeURIComponent(caseId)}/midscene-report`
        : null,
    };
  }

  /** 将服务重启或强制终止遗留的运行态用例标记为失败。 */
  async recoverInterruptedCases(): Promise<number> {
    const running = new Set(['EXPLORING', 'GENERATING_SCRIPT', 'COMPILING', 'CONVERGING']);
    let recovered = 0;
    for (const summary of await this.list()) {
      if (!running.has(summary.pipelineStatus)) continue;
      const paths = this.paths(summary.caseId);
      const manifest = await this.read(paths);
      manifest.pipelineStatus = 'FAILED';
      manifest.pipelineError = '上一次任务在服务停止或人工终止后未正常完成。';
      await this.save(paths, manifest);
      recovered += 1;
    }
    return recovered;
  }
}
