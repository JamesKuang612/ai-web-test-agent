import type { CaseSummary } from '../types';
import { formatDuration, statusLabel } from '../ui';
import { StatusBadge } from './StatusBadge';

/** 展示本地测试用例列表。 */
export function CaseList({ cases, onOpen }: { cases: CaseSummary[]; onOpen: (caseId: string) => void }) {
  if (!cases.length)
    return (
      <div className="empty-state">
        <strong>还没有测试用例</strong>
        <span>点击右上角创建第一条自然语言测试用例。</span>
      </div>
    );
  return (
    <div className="case-grid">
      {cases.map((item) => (
        <button className="case-card" type="button" key={item.caseId} onClick={() => onOpen(item.caseId)}>
          <div className="case-card-heading">
            <strong>{item.caseId}</strong>
            <StatusBadge value={item.pipelineStatus} />
          </div>
          <p>{item.instruction.replaceAll('\n', ' ')}</p>
          <div className="case-meta">
            Playwright 脚本：{statusLabel(item.script)}　探索：
            {item.exploreEngine === 'midscene' ? 'Midscene' : 'Codex'} / {formatDuration(item.exploreDurationMs)}
            　更新：{new Date(item.updatedAt).toLocaleString()}
          </div>
        </button>
      ))}
    </div>
  );
}
