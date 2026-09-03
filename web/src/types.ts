export interface AgentConfig {
  model: string;
  reasoningEffort: string;
}
export interface FastExplore {
  status: string;
  durationMs: number;
  model: string;
  stepLimit?: number;
  actions: number;
  modelCalls: number;
  modelTimeMs: number;
  reportFile: string | null;
}
export interface Asset {
  file: string;
  status: string;
  agentConfig: AgentConfig | null;
}
export interface Run {
  mode: string;
  status: string;
  durationMs: number;
  runAt: string;
}
export interface Manifest {
  caseId: string;
  originalInstruction: string;
  pipelineStatus: string;
  pipelineError: string | null;
  threadId: string | null;
  explore: null | {
    status: string;
    durationMs: number;
    finalResponse: string;
    mcpCalls: number;
    agentConfig?: AgentConfig | null;
    engine?: string;
    fastPath?: FastExplore | null;
  };
  script: Asset;
  runs: Run[];
}
export interface Trace {
  sequence: number;
  tool: string;
  arguments: unknown;
  status: string;
}
export interface CaseSummary {
  caseId: string;
  instruction: string;
  pipelineStatus: string;
  updatedAt: string;
  script: string;
  exploreEngine: string;
  exploreDurationMs: number | null;
}
export interface CaseDetail {
  manifest: Manifest;
  trace: Trace[];
  scriptSource: string | null;
  midsceneReportUrl: string | null;
}
export interface Job {
  id: string;
  caseId: string;
  action: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  output: string;
  exitCode: number | null;
}
