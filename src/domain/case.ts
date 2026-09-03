import type { ThreadItem } from '@openai/codex-sdk';

import type { TraceEntry } from '../shared/trace.js';

export const AGENT_MODELS = [
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-5.6-luna',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
] as const;
export const GPT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const DEEPSEEK_REASONING_EFFORTS = ['low', 'high', 'max'] as const;

export type AgentModel = (typeof AGENT_MODELS)[number];
export type ReasoningEffort = (typeof GPT_REASONING_EFFORTS)[number] | (typeof DEEPSEEK_REASONING_EFFORTS)[number];
export interface AgentConfig {
  model: AgentModel;
  reasoningEffort: ReasoningEffort;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  model: 'gpt-5.6-terra',
  reasoningEffort: 'medium',
};

export type AssetStatus = 'PENDING' | 'DRAFT' | 'GENERATING' | 'VALIDATED' | 'INVALID';
export type RunMode = 'agent' | 'script' | 'conservative' | 'optimized';
export type ExploreStrategy = 'codex-only' | 'midscene-only';
export type ExploreEngine = 'codex' | 'midscene';
export type PipelineStatus =
  | 'EXPLORING'
  | 'EXPLORED'
  | 'GENERATING_SCRIPT'
  | 'COMPLETED'
  | 'FAILED'
  | 'GENERATING_FAITHFUL'
  | 'FAITHFUL_READY'
  | 'GENERATING_OPTIMIZED'
  | 'CONVERGING'
  | 'COMPILING';

export interface ValidationRecord {
  status: Extract<AssetStatus, 'VALIDATED' | 'INVALID'>;
  durationMs: number;
  exitCode: number;
  runAt: string;
  error: string | null;
}

export interface AssetRecord {
  file: string;
  status: AssetStatus;
  agentConfig: AgentConfig | null;
  validation: ValidationRecord | null;
}

export interface RunRecord {
  mode: RunMode;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  runAt: string;
  threadId: string | null;
  traceFile: string | null;
  error: string | null;
  agentConfig: AgentConfig | null;
}

export interface FastExploreRecord {
  status: 'PASS' | 'FAIL';
  durationMs: number;
  model: string;
  stepLimit?: number;
  reportFile: string | null;
  actions: number;
  modelCalls: number;
  modelTimeMs: number;
  error: string | null;
}

export interface ExploreRecord {
  status: 'PASS' | 'FAIL';
  durationMs: number;
  finalResponse: string;
  traceFile: string;
  mcpCalls: number;
  agentConfig?: AgentConfig | null;
  engine?: ExploreEngine;
  strategy?: ExploreStrategy;
  fastPath?: FastExploreRecord | null;
}

export interface CaseManifest {
  version: 1 | 2 | 3 | 4 | 5;
  caseId: string;
  originalInstruction: string;
  createdAt: string;
  updatedAt: string;
  pipelineStatus: PipelineStatus;
  pipelineError: string | null;
  threadId: string | null;
  explore: ExploreRecord | null;
  script: AssetRecord;
  conservative?: AssetRecord;
  optimized?: AssetRecord;
  runs: RunRecord[];
}

export interface CasePaths {
  directory: string;
  instruction: string;
  manifest: string;
  rawTrace: string;
  script: string;
  conservative: string;
  optimized: string;
  runs: string;
}

export interface ExploreResult {
  threadId: string;
  items: ThreadItem[];
  trace: TraceEntry[];
  finalResponse: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  agentConfig: AgentConfig;
}

/** 创建尚未生成的 Playwright 资产记录。 */
export function createAssetRecord(file = 'playwright.spec.ts'): AssetRecord {
  return { file, status: 'PENDING', agentConfig: null, validation: null };
}

/** 创建尚未执行的当前版本用例清单。 */
export function createManifest(caseId: string, instruction: string): CaseManifest {
  const now = new Date().toISOString();
  return {
    version: 5,
    caseId,
    originalInstruction: instruction,
    createdAt: now,
    updatedAt: now,
    pipelineStatus: 'EXPLORING',
    pipelineError: null,
    threadId: null,
    explore: null,
    script: createAssetRecord(),
    runs: [],
  };
}
