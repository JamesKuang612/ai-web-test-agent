import type { Job } from '../types';
import { actionLabel } from '../ui';
import { StatusBadge } from './StatusBadge';

/** 展示后台任务实时输出并允许终止运行中的任务。 */
export function JobDrawer({ job, onClose, onCancel }: { job: Job | null; onClose: () => void; onCancel: () => void }) {
  if (!job) return null;
  return (
    <aside className="job-drawer">
      <header className="job-header">
        <div>
          <p className="eyebrow">当前任务</p>
          <strong>
            {actionLabel(job.action)} · {job.caseId}
          </strong>
        </div>
        <div className="job-header-actions">
          <StatusBadge value={job.status} />
          {job.status === 'running' && (
            <button className="drawer-cancel" type="button" onClick={onCancel}>
              终止
            </button>
          )}
          <button className="drawer-close" type="button" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <pre>{job.output || '任务已启动，等待输出……'}</pre>
    </aside>
  );
}
