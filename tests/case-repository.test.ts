import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CaseRepository } from '../src/cases/case-repository.js';
import { createManifest } from '../src/domain/case.js';

const temporaryDirectories: string[] = [];

/** 创建并登记一个测试结束后可清理的临时目录。 */
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-web-test-agent-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('本地用例仓储', () => {
  it('保存并读取当前 manifest', async () => {
    const repository = new CaseRepository(await temporaryRoot());
    const paths = repository.paths('case-1');
    await repository.createDirectories(paths);
    const manifest = createManifest('case-1', '打开页面');
    manifest.pipelineStatus = 'EXPLORED';
    await repository.save(paths, manifest);
    expect((await repository.read(paths)).pipelineStatus).toBe('EXPLORED');
    expect(JSON.parse(await readFile(paths.manifest, 'utf8')).caseId).toBe('case-1');
  });

  it('兼容旧版已验证脚本资产', async () => {
    const repository = new CaseRepository(await temporaryRoot());
    const paths = repository.paths('legacy-case');
    await repository.createDirectories(paths);
    const manifest = createManifest('legacy-case', '旧用例');
    const legacy = { file: 'optimized.spec.ts', status: 'VALIDATED', agentConfig: null, validation: null };
    const serialized = { ...manifest, version: 4, script: undefined, optimized: legacy };
    await writeFile(paths.manifest, `${JSON.stringify(serialized)}\n`, 'utf8');
    expect((await repository.read(paths)).script).toEqual(legacy);
  });

  it('拒绝路径穿越用例 ID', async () => {
    const repository = new CaseRepository(await temporaryRoot());
    expect(() => repository.paths('../outside')).toThrow('用例 ID');
  });

  it('将服务中断遗留状态恢复为失败', async () => {
    const repository = new CaseRepository(await temporaryRoot());
    const paths = repository.paths('interrupted');
    await repository.createDirectories(paths);
    await repository.save(paths, createManifest('interrupted', '测试'));
    expect(await repository.recoverInterruptedCases()).toBe(1);
    expect((await repository.read(paths)).pipelineStatus).toBe('FAILED');
  });
});
