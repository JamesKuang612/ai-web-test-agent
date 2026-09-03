import { createReadStream } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { CaseService } from '../application/case-service.js';
import { CaseRepository } from '../cases/case-repository.js';
import { parseAgentConfig } from '../config/agent-config.js';
import { JobService } from '../jobs/job-service.js';
import { caseParamsSchema, exploreBodySchema, generateBodySchema, jobParamsSchema, runBodySchema } from './schemas.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 4173);
const WEB_ROOT = path.resolve('web-dist');
const RUNTIME_ROOT = path.resolve('.runtime');
const repository = new CaseRepository();
const caseService = new CaseService(repository);
const jobs = new JobService(caseService);

/** 创建 Fastify API，并保持原有前端接口兼容。 */
async function buildServer() {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(fastifyStatic, { root: WEB_ROOT, wildcard: false });

  app.get('/api/cases', () => repository.list());
  app.get('/api/cases/:caseId', async (request) => {
    const { caseId } = caseParamsSchema.parse(request.params);
    return repository.detail(caseId);
  });
  app.get('/api/cases/:caseId/midscene-report', async (request, reply) => {
    const { caseId } = caseParamsSchema.parse(request.params);
    const manifest = await repository.read(repository.paths(caseId));
    const reportFile = manifest.explore?.fastPath?.reportFile;
    if (!reportFile) return reply.code(404).send({ error: '该用例没有 Midscene 报告。' });
    const reportRoot = path.resolve(process.env.MIDSCENE_RUN_DIR ?? 'midscene_run', 'report');
    const reportPath = path.resolve(reportFile);
    if (!reportPath.startsWith(`${reportRoot}${path.sep}`)) throw new Error('Midscene 报告路径无效。');
    await access(reportPath);
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(createReadStream(reportPath));
  });

  app.get('/api/jobs/:jobId', (request, reply) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    const job = jobs.get(jobId);
    return job ?? reply.code(404).send({ error: '任务不存在。' });
  });
  app.post('/api/jobs/:jobId/cancel', async (request) => {
    const { jobId } = jobParamsSchema.parse(request.params);
    return jobs.cancel(jobId);
  });

  app.post('/api/explore', async (request, reply) => {
    const body = exploreBodySchema.parse(request.body);
    const paths = repository.paths(body.caseId);
    try {
      await access(paths.directory);
      return reply.code(409).send({ error: `用例 ${body.caseId} 已存在，请使用新的用例 ID。` });
    } catch {
      // 目录不存在才继续创建任务。
    }
    await mkdir(RUNTIME_ROOT, { recursive: true });
    const instructionFile = path.join(RUNTIME_ROOT, `${body.caseId}-${Date.now()}.txt`);
    await writeFile(instructionFile, `${body.instruction}\n`, 'utf8');
    const config = parseAgentConfig(body.model, body.reasoningEffort);
    const job = await jobs.start(
      body.caseId,
      'explore',
      [
        'explore',
        '--case',
        body.caseId,
        '--instruction',
        instructionFile,
        '--strategy',
        body.strategy,
        '--steps',
        String(body.stepLimit),
        '--model',
        config.model,
        '--reasoning',
        config.reasoningEffort,
      ],
      [instructionFile],
    );
    return reply.code(202).send(job);
  });

  app.post('/api/generate', async (request, reply) => {
    const body = generateBodySchema.parse(request.body);
    await access(repository.paths(body.caseId).manifest);
    const config = parseAgentConfig(body.model, body.reasoningEffort);
    return reply
      .code(202)
      .send(
        await jobs.start(body.caseId, 'generate', [
          'generate',
          '--case',
          body.caseId,
          '--model',
          config.model,
          '--reasoning',
          config.reasoningEffort,
        ]),
      );
  });

  app.post('/api/run', async (request, reply) => {
    const body = runBodySchema.parse(request.body);
    await access(repository.paths(body.caseId).manifest);
    const config = parseAgentConfig(body.model, body.reasoningEffort);
    return reply
      .code(202)
      .send(
        await jobs.start(body.caseId, body.mode, [
          'run',
          '--case',
          body.caseId,
          '--mode',
          body.mode,
          '--model',
          config.model,
          '--reasoning',
          config.reasoningEffort,
        ]),
      );
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? '请求参数无效。' });
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 400;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message });
  });
  app.setNotFoundHandler((request, reply) =>
    request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在。' }) : reply.sendFile('index.html'),
  );
  return app;
}

/** 初始化持久化任务、修复遗留状态并启动本地服务。 */
async function main(): Promise<void> {
  await jobs.initialize();
  const recovered = await repository.recoverInterruptedCases();
  if (recovered) console.log(`[状态修复] 已将 ${recovered} 个遗留运行态用例标记为失败。`);
  const app = await buildServer();
  await app.listen({ host: HOST, port: PORT });
  console.log(`AI Web Test Agent：http://${HOST}:${PORT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
