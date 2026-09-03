import { statusClass, statusLabel } from '../ui';

/** 展示统一的中文状态徽标。 */
export function StatusBadge({ value }: { value?: string | null }) {
  return <span className={`status ${statusClass(value ?? '') || 'neutral'}`}>{statusLabel(value)}</span>;
}
