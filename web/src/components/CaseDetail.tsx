import type { AgentConfig, CaseDetail as CaseDetailData } from '../types';
import { actionLabel, configLabel, formatDuration, statusLabel } from '../ui';
import { ModelFields } from './ModelFields';
import { StatusBadge } from './StatusBadge';

interface CaseDetailProps {
  detail: CaseDetailData;
  busy: boolean;
  config: AgentConfig;
  onConfigChange: (config: AgentConfig) => void;
  onBack: () => void;
  onGenerate: () => void;
  onRun: (mode: 'agent' | 'script') => void;
}

/** 展示单条用例的探索证据、脚本资产和执行历史。 */
export function CaseDetail({ detail, busy, config, onConfigChange, onBack, onGenerate, onRun }: CaseDetailProps) {
  const { manifest, trace, scriptSource, midsceneReportUrl } = detail;
  const canGenerate = manifest.explore?.status === 'PASS' && Boolean(manifest.threadId);
  const canReplay = manifest.script.status === 'VALIDATED';
  return (
    <main className="page">
      <button className="back-button" type="button" onClick={onBack}>
        ← 返回测试用例
      </button>
      <section className="detail-header">
        <div>
          <p className="eyebrow">测试用例详情</p>
          <h1>{manifest.caseId}</h1>
        </div>
        <div className="detail-controls">
          <div className="model-controls">
            <ModelFields
              model={config.model}
              effort={config.reasoningEffort}
              disabled={busy}
              onChange={(model, reasoningEffort) => onConfigChange({ model, reasoningEffort })}
            />
          </div>
          <div className="detail-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => onRun('agent')}>
              重新正常探索
            </button>
            <button className="secondary strong" type="button" disabled={busy || !canGenerate} onClick={onGenerate}>
              生成 Playwright 脚本
            </button>
            <button className="primary" type="button" disabled={busy || !canReplay} onClick={() => onRun('script')}>
              零模型重放
            </button>
          </div>
        </div>
      </section>

      <section className="metrics">
        <div className="metric">
          <span>整体状态</span>
          <StatusBadge value={manifest.pipelineStatus} />
        </div>
        <div className="metric">
          <span>探索结果</span>
          <StatusBadge value={manifest.explore?.status ?? 'PENDING'} />
        </div>
        <div className="metric">
          <span>探索引擎</span>
          <strong>{manifest.explore?.engine === 'midscene' ? 'Midscene' : 'Codex'}</strong>
        </div>
        <div className="metric">
          <span>探索耗时</span>
          <strong>{formatDuration(manifest.explore?.durationMs)}</strong>
        </div>
        <div className="metric">
          <span>Codex 会话</span>
          <strong title={manifest.threadId ?? ''}>{manifest.threadId ?? '无'}</strong>
        </div>
      </section>

      <section className="panel instruction-panel">
        <p className="eyebrow">自然语言测试用例</p>
        <pre>{manifest.originalInstruction}</pre>
      </section>
      {manifest.explore && (
        <section className="panel result-panel">
          <p className="eyebrow">最近一次探索结果</p>
          <pre>{manifest.explore.finalResponse}</pre>
          {midsceneReportUrl && (
            <a className="report-link" href={midsceneReportUrl} target="_blank" rel="noreferrer">
              打开 Midscene 可视化报告 ↗
            </a>
          )}
        </section>
      )}
      {manifest.pipelineError && (
        <section className="panel error-panel">
          <p className="eyebrow">最近错误</p>
          <pre>{manifest.pipelineError}</pre>
        </section>
      )}

      <section className="assets single">
        <article className="panel asset-card">
          <div className="asset-header">
            <div>
              <p className="eyebrow">独立验证产物</p>
              <h2>Playwright 脚本</h2>
              <p>恢复原 Codex 会话生成，只有通过 Fresh Validation 后才能零模型重放。</p>
              <p className="asset-config">{configLabel(manifest.script.agentConfig)}</p>
            </div>
            <StatusBadge value={manifest.script.status} />
          </div>
          {scriptSource ? (
            <details>
              <summary>查看 Playwright 脚本</summary>
              <pre className="code">{scriptSource}</pre>
            </details>
          ) : (
            <p className="empty-copy">尚未生成脚本。</p>
          )}
        </article>
      </section>

      <section className="panel trace-panel">
        <details>
          <summary>探索工具轨迹（{trace.length} 条）</summary>
          <div className="trace-list">
            {trace.length ? (
              trace.map((item) => (
                <div className="trace-row" key={`${item.sequence}-${item.tool}`}>
                  <span>#{item.sequence}</span>
                  <span>{item.tool}</span>
                  <span>{JSON.stringify(item.arguments)}</span>
                  <span>{statusLabel(item.status)}</span>
                </div>
              ))
            ) : (
              <p className="empty-copy">没有工具轨迹。</p>
            )}
          </div>
        </details>
      </section>

      <section className="panel runs-panel">
        <p className="eyebrow">执行历史</p>
        {manifest.runs.length ? (
          manifest.runs.toReversed().map((run) => (
            <div className="run-row" key={`${run.runAt}-${run.mode}`}>
              <span>{actionLabel(run.mode)}</span>
              <StatusBadge value={run.status} />
              <span>{formatDuration(run.durationMs)}</span>
              <span>{new Date(run.runAt).toLocaleString()}</span>
            </div>
          ))
        ) : (
          <p className="empty-copy">暂无重复执行记录。</p>
        )}
      </section>
    </main>
  );
}
