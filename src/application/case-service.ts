import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CodexAgent } from '../agents/codex-agent.js';
import { MIDSCENE_MODEL, MidsceneAgent, type MidsceneExploreResult } from '../agents/midscene-agent.js';
import { CaseRepository } from '../cases/case-repository.js';
import {
  type AgentConfig,
  type CaseManifest,
  createManifest,
  type ExploreStrategy,
  type RunMode,
  type RunRecord,
} from '../domain/case.js';
import { validateSpec } from '../playwright/validator.js';
import { printTrace } from '../shared/trace.js';

export interface ExploreCommand {
  caseId: string;
  instruction: string;
  config: AgentConfig;
  strategy: ExploreStrategy;
  stepLimit: number;
}

/** 将未知错误转成稳定的用户可读文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 构造一条最小的运行历史记录。 */
function runRecord(
  mode: RunMode,
  status: 'PASS' | 'FAIL',
  durationMs: number,
  threadId: string | null,
  traceFile: string | null,
  error: string | null,
  config: AgentConfig | null = null,
): RunRecord {
  return { mode, status, durationMs, runAt: new Date().toISOString(), threadId, traceFile, error, agentConfig: config };
}

/** 将 Midscene 结果转换为持久化记录。 */
function fastExploreRecord(result: MidsceneExploreResult, stepLimit: number) {
  return {
    status: result.status,
    durationMs: result.durationMs,
    model: MIDSCENE_MODEL,
    stepLimit,
    reportFile: result.reportFile,
    actions: result.actions,
    modelCalls: result.modelCalls,
    modelTimeMs: result.modelTimeMs,
    error: result.error,
  };
}

/** 编排探索、脚本生成、验证和重放，但不处理 HTTP 或 CLI 参数。 */
export class CaseService {
  constructor(
    private readonly repository = new CaseRepository(),
    private readonly codex = new CodexAgent(),
    private readonly midscene = new MidsceneAgent(),
  ) {}

  /** 创建用例并运行用户选择的独立探索引擎。 */
  async explore(command: ExploreCommand): Promise<void> {
    const paths = this.repository.paths(command.caseId);
    await this.repository.createDirectories(paths);
    await this.repository.writeInstruction(paths, command.instruction);
    const manifest = createManifest(command.caseId, command.instruction);
    await this.repository.save(paths, manifest);

    try {
      console.log(`[创建并探索] ${command.caseId}`);
      console.log(`[探索方式] ${command.strategy === 'midscene-only' ? '快速探索（Midscene）' : '正常探索（Codex）'}`);
      if (command.strategy === 'midscene-only') {
        await this.exploreWithMidscene(paths, manifest, command);
      } else {
        await this.exploreWithCodex(paths, manifest, command);
      }
    } catch (error) {
      manifest.pipelineStatus = 'FAILED';
      manifest.pipelineError = errorMessage(error);
      await this.repository.save(paths, manifest);
      throw error;
    }
  }

  /** 运行快速视觉探索并保存报告元数据。 */
  private async exploreWithMidscene(
    paths: ReturnType<CaseRepository['paths']>,
    manifest: CaseManifest,
    command: ExploreCommand,
  ): Promise<void> {
    console.log(`[快速探索] ${MIDSCENE_MODEL} / 最多 ${command.stepLimit} 次规划`);
    const result = await this.midscene.explore(command.instruction, command.caseId, command.stepLimit);
    console.log(
      `[快速探索结果] ${result.status} / ${(result.durationMs / 1000).toFixed(1)} 秒 / ${result.actions} 个动作 / ${result.modelCalls} 次模型调用`,
    );
    if (result.reportFile) console.log(`[Midscene 报告] ${result.reportFile}`);
    await this.repository.writeTrace(paths.rawTrace, result.trace);
    manifest.threadId = null;
    manifest.explore = {
      status: result.status,
      durationMs: result.durationMs,
      finalResponse: result.finalResponse,
      traceFile: 'raw-trace.json',
      mcpCalls: 0,
      agentConfig: null,
      engine: 'midscene',
      strategy: command.strategy,
      fastPath: fastExploreRecord(result, command.stepLimit),
    };
    console.log(`\n[探索结果]\n${result.finalResponse}`);
    if (result.status !== 'PASS') throw new Error('Midscene 快速探索未通过，不会自动转入 Codex。');
    manifest.pipelineStatus = 'EXPLORED';
    manifest.pipelineError = null;
    await this.repository.save(paths, manifest);
    console.log('\n[提示] 本次只运行 Midscene，没有创建 Codex 会话。');
    console.log(`\n[探索完成] ${paths.directory}`);
  }

  /** 运行原 Codex + Playwright MCP 探索链路。 */
  private async exploreWithCodex(
    paths: ReturnType<CaseRepository['paths']>,
    manifest: CaseManifest,
    command: ExploreCommand,
  ): Promise<void> {
    console.log(`[Codex 模型配置] ${command.config.model} / ${command.config.reasoningEffort}`);
    console.log('[探索] 创建新的 Codex thread');
    const result = await this.codex.explore(command.instruction, command.config);
    await this.repository.writeTrace(paths.rawTrace, result.trace);
    manifest.threadId = result.threadId;
    manifest.explore = {
      status: result.status,
      durationMs: result.durationMs,
      finalResponse: result.finalResponse,
      traceFile: 'raw-trace.json',
      mcpCalls: result.trace.length,
      agentConfig: command.config,
      engine: 'codex',
      strategy: command.strategy,
      fastPath: null,
    };
    printTrace(result.items);
    console.log(`\n[探索结果]\n${result.finalResponse}`);
    if (result.status !== 'PASS') throw new Error('Agent 探索未通过，未进入脚本生成阶段。');
    manifest.pipelineStatus = 'EXPLORED';
    manifest.pipelineError = null;
    await this.repository.save(paths, manifest);
    console.log(`\n[探索完成] ${paths.directory}`);
  }

  /** 恢复原 Codex 会话，生成脚本并做独立验证。 */
  async generate(caseId: string, config: AgentConfig): Promise<void> {
    const paths = this.repository.paths(caseId);
    const manifest = await this.repository.read(paths);
    if (manifest.explore?.status !== 'PASS' || !manifest.threadId) {
      throw new Error('只有 Codex 探索成功的测试用例才能生成 Playwright 脚本。');
    }
    manifest.version = 5;
    manifest.script = { file: 'playwright.spec.ts', status: 'GENERATING', agentConfig: config, validation: null };
    manifest.pipelineStatus = 'GENERATING_SCRIPT';
    manifest.pipelineError = null;
    await this.repository.save(paths, manifest);

    try {
      console.log(`[生成 Playwright 脚本] ${caseId}`);
      console.log(`[恢复 Codex 会话] ${manifest.threadId}`);
      console.log(`[模型配置] ${config.model} / ${config.reasoningEffort}`);
      const turn = await this.codex.generateScript(manifest.threadId, paths.script, config);
      printTrace(turn.items);
      console.log(`\n[Codex 生成结果]\n${turn.finalResponse.trim()}`);
      const source = await readFile(paths.script, 'utf8');
      if (!source.trim()) throw new Error('Codex 生成的 Playwright 脚本为空。');
      console.log(`\n[验证脚本] ${path.relative(process.cwd(), paths.script)}`);
      const validation = await validateSpec(paths.script);
      manifest.script.status = validation.status;
      manifest.script.validation = validation;
      await this.repository.save(paths, manifest);
      console.log(`[验证结果] ${manifest.script.status}`);
      if (manifest.script.status !== 'VALIDATED') {
        throw new Error('Codex 生成的脚本未通过独立 Fresh Validation。');
      }
      manifest.pipelineStatus = 'COMPLETED';
      manifest.pipelineError = null;
      await this.repository.save(paths, manifest);
      console.log(`\n[Playwright 脚本完成] ${paths.script}`);
    } catch (error) {
      if (manifest.script.status === 'GENERATING') manifest.script.status = 'INVALID';
      manifest.pipelineStatus = 'FAILED';
      manifest.pipelineError = errorMessage(error);
      await this.repository.save(paths, manifest);
      throw error;
    }
  }

  /** 执行新的 Codex 探索或零模型脚本重放。 */
  async run(caseId: string, mode: 'agent' | 'script', config: AgentConfig): Promise<void> {
    const paths = this.repository.paths(caseId);
    const manifest = await this.repository.read(paths);
    if (mode === 'agent') {
      console.log('[Agent 探索] 创建新的 Codex thread');
      console.log(`[模型配置] ${config.model} / ${config.reasoningEffort}`);
      const result = await this.codex.explore(manifest.originalInstruction, config);
      const traceName = `${Date.now()}-agent-trace.json`;
      await this.repository.writeTrace(path.join(paths.runs, traceName), result.trace);
      manifest.runs.push(
        runRecord(
          'agent',
          result.status,
          result.durationMs,
          result.threadId,
          `runs/${traceName}`,
          result.status === 'PASS' ? null : result.finalResponse,
          config,
        ),
      );
      await this.repository.save(paths, manifest);
      console.log(`[Thread ID] ${result.threadId}`);
      printTrace(result.items);
      console.log(`\n[Agent 结果]\n${result.finalResponse}`);
      if (result.status === 'FAIL') process.exitCode = 1;
      return;
    }

    if (manifest.script.status !== 'VALIDATED') {
      throw new Error(`Playwright 脚本当前为 ${manifest.script.status}，不可执行且不会回退到 Agent。`);
    }
    console.log('[CODEX 调用次数] 0');
    const validation = await validateSpec(this.repository.scriptPath(paths, manifest));
    const status = validation.status === 'VALIDATED' ? 'PASS' : 'FAIL';
    manifest.runs.push(runRecord('script', status, validation.durationMs, null, null, validation.error));
    await this.repository.save(paths, manifest);
    console.log(`[零模型重放] ${status}`);
    if (status === 'FAIL') process.exitCode = 1;
  }

  /** 将被取消或异常遗留的用例状态收敛为失败。 */
  async markInterrupted(caseId: string, reason: string): Promise<void> {
    const paths = this.repository.paths(caseId);
    const manifest = await this.repository.read(paths);
    manifest.pipelineStatus = 'FAILED';
    manifest.pipelineError = reason;
    await this.repository.save(paths, manifest);
  }
}
