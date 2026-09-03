import { type FormEvent, useEffect, useRef, useState } from 'react';

import { newCaseId } from '../ui';
import { ModelFields } from './ModelFields';

export interface CreateValues {
  caseId: string;
  instruction: string;
  strategy: 'midscene-only' | 'codex-only';
  stepLimit: number;
  model: string;
  reasoningEffort: string;
}

/** 收集新用例及探索方式。 */
export function CreateDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: CreateValues) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [caseId, setCaseId] = useState(newCaseId);
  const [instruction, setInstruction] = useState('');
  const [strategy, setStrategy] = useState<CreateValues['strategy']>('midscene-only');
  const [stepLimit, setStepLimit] = useState(20);
  const [model, setModel] = useState('gpt-5.6-terra');
  const [reasoningEffort, setEffort] = useState('medium');
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ caseId, instruction, strategy, stepLimit, model, reasoningEffort });
    setCaseId(newCaseId());
    setInstruction('');
  };
  return (
    <dialog ref={dialog} onCancel={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-header">
          <div>
            <p className="eyebrow">新建</p>
            <h2>创建测试用例</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          用例 ID
          <input value={caseId} onChange={(event) => setCaseId(event.target.value)} required />
        </label>
        <label>
          自然语言测试用例
          <textarea
            rows={12}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="粘贴完整测试用例，包括初始 URL、操作步骤和预期结果。"
            required
          />
        </label>
        <label>
          探索方式
          <select value={strategy} onChange={(event) => setStrategy(event.target.value as CreateValues['strategy'])}>
            <option value="midscene-only">快速探索（Midscene）</option>
            <option value="codex-only">正常探索（Codex）</option>
          </select>
        </label>
        <label>
          快速探索 Step 上限
          <input
            type="number"
            min="1"
            max="100"
            value={stepLimit}
            disabled={strategy !== 'midscene-only'}
            onChange={(event) => setStepLimit(Number(event.target.value))}
            required
          />
        </label>
        <ModelFields
          model={model}
          effort={reasoningEffort}
          disabled={strategy === 'midscene-only'}
          onChange={(nextModel, nextEffort) => {
            setModel(nextModel);
            setEffort(nextEffort);
          }}
        />
        <p className="hint">
          {strategy === 'midscene-only'
            ? `仅运行 Midscene，最多 ${stepLimit} Step；失败后不会调用 Codex。`
            : '保持原 Codex + Playwright MCP 链路，并保存可继续生成脚本的会话。'}
        </p>
        <div className="dialog-actions">
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy} type="submit">
            开始{strategy === 'midscene-only' ? '快速' : '正常'}探索
          </button>
        </div>
      </form>
    </dialog>
  );
}
