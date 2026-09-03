import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import { CaseDetail } from './components/CaseDetail';
import { CaseList } from './components/CaseList';
import { CreateDialog, type CreateValues } from './components/CreateDialog';
import { JobDrawer } from './components/JobDrawer';
import { StatusBadge } from './components/StatusBadge';
import type { AgentConfig, CaseDetail as CaseDetailData, CaseSummary, Job } from './types';

const TERMINAL_JOBS = new Set(['completed', 'failed', 'cancelled']);

/** 解析当前 hash 中选中的用例。 */
function selectedCaseFromHash(): string | null {
  const match = location.hash.match(/^#\/cases\/([^/]+)$/);
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

/** 管理测试用例列表、详情和后台任务交互。 */
export function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedCase, setSelectedCase] = useState(selectedCaseFromHash);
  const [detail, setDetail] = useState<CaseDetailData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AgentConfig>({ model: 'gpt-5.6-terra', reasoningEffort: 'medium' });

  const loadCases = useCallback(async () => setCases(await api<CaseSummary[]>('/api/cases')), []);
  const loadDetail = useCallback(async (caseId: string) => {
    const next = await api<CaseDetailData>(`/api/cases/${encodeURIComponent(caseId)}`);
    setDetail(next);
    const recorded = next.manifest.explore?.agentConfig ?? next.manifest.script.agentConfig;
    if (recorded) setConfig(recorded);
  }, []);

  useEffect(() => {
    void loadCases().catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
    const onHashChange = () => setSelectedCase(selectedCaseFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [loadCases]);
  useEffect(() => {
    if (!selectedCase) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedCase).catch((value: unknown) =>
      setError(value instanceof Error ? value.message : String(value)),
    );
  }, [loadDetail, selectedCase]);

  /** 轮询单个持久化后台任务，直到进入终态。 */
  const watchJob = useCallback(
    async (initial: Job): Promise<Job> => {
      setJob(initial);
      let current = initial;
      while (!TERMINAL_JOBS.has(current.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        current = await api<Job>(`/api/jobs/${encodeURIComponent(initial.id)}`);
        setJob(current);
      }
      await loadCases();
      if (current.caseId === selectedCaseFromHash()) await loadDetail(current.caseId);
      return current;
    },
    [loadCases, loadDetail],
  );

  /** 创建测试用例并启动所选探索引擎。 */
  const createCase = async (values: CreateValues) => {
    setError(null);
    setCreateOpen(false);
    try {
      await watchJob(await api<Job>('/api/explore', { method: 'POST', body: JSON.stringify(values) }));
      location.hash = `/cases/${encodeURIComponent(values.caseId)}`;
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  /** 启动用例详情页上的后台动作。 */
  const startAction = async (url: string, body: object) => {
    setError(null);
    try {
      await watchJob(await api<Job>(url, { method: 'POST', body: JSON.stringify(body) }));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  const busy = job?.status === 'running';
  return (
    <>
      <header className="topbar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            location.hash = '/';
          }}
        >
          <span className="brand-mark">A</span>
          <span>
            <strong>AI Web 测试助手</strong>
            <small>本地测试控制台</small>
          </span>
        </button>
        <StatusBadge value={job?.status ?? detail?.manifest.pipelineStatus ?? 'ready'} />
      </header>
      {selectedCase && detail ? (
        <CaseDetail
          detail={detail}
          busy={busy}
          config={config}
          onConfigChange={setConfig}
          onBack={() => {
            location.hash = '/';
          }}
          onGenerate={() => void startAction('/api/generate', { caseId: detail.manifest.caseId, ...config })}
          onRun={(mode) => void startAction('/api/run', { caseId: detail.manifest.caseId, mode, ...config })}
        />
      ) : (
        <main className="page">
          <section className="page-header">
            <div>
              <p className="eyebrow">本地测试资产</p>
              <h1>测试用例</h1>
              <p className="page-description">管理自然语言用例、探索结果和可重复执行的 Playwright 脚本。</p>
            </div>
            <button className="primary" type="button" onClick={() => setCreateOpen(true)}>
              ＋ 创建测试用例
            </button>
          </section>
          <div className="list-toolbar">
            <span>{cases.length} 个测试用例</span>
            <button className="text-button" type="button" onClick={() => void loadCases()}>
              刷新列表
            </button>
          </div>
          <CaseList
            cases={cases}
            onOpen={(caseId) => {
              location.hash = `/cases/${encodeURIComponent(caseId)}`;
            }}
          />
        </main>
      )}
      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      <CreateDialog
        open={createOpen}
        busy={busy}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => void createCase(values)}
      />
      <JobDrawer
        job={job}
        onClose={() => {
          if (!busy) setJob(null);
        }}
        onCancel={() => {
          if (job)
            void api<Job>(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' })
              .then(setJob)
              .catch((value: unknown) => setError(value instanceof Error ? value.message : String(value)));
        }}
      />
    </>
  );
}
