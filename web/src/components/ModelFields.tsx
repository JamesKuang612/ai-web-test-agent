import { DEEPSEEK_EFFORTS, DEEPSEEK_MODELS, GPT_EFFORTS, MODEL_OPTIONS } from '../ui';

interface Props {
  model: string;
  effort: string;
  disabled?: boolean;
  onChange: (model: string, effort: string) => void;
}

/** 展示模型和兼容推理强度下拉框。 */
export function ModelFields({ model, effort, disabled, onChange }: Props) {
  const efforts = DEEPSEEK_MODELS.has(model) ? DEEPSEEK_EFFORTS : GPT_EFFORTS;
  const effective = efforts.some(([value]) => value === effort)
    ? effort
    : DEEPSEEK_MODELS.has(model)
      ? 'high'
      : 'medium';
  return (
    <div className={`dialog-model-grid ${disabled ? 'disabled-controls' : ''}`}>
      <label>
        模型
        <select
          disabled={disabled}
          value={model}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next, DEEPSEEK_MODELS.has(next) ? 'high' : 'medium');
          }}
        >
          {MODEL_OPTIONS.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        推理强度
        <select disabled={disabled} value={effective} onChange={(event) => onChange(model, event.target.value)}>
          {efforts.map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
