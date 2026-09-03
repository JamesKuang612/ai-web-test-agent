import { describe, expect, it } from 'vitest';

import { exploreBodySchema, runBodySchema } from '../src/api/schemas.js';

describe('API 输入校验', () => {
  it('为探索请求补齐稳定默认值', () => {
    const value = exploreBodySchema.parse({ caseId: 'case-1', instruction: '打开页面' });
    expect(value.strategy).toBe('codex-only');
    expect(value.stepLimit).toBe(20);
  });

  it('拒绝越界的 Midscene Step 上限', () => {
    expect(() => exploreBodySchema.parse({ caseId: 'case-1', instruction: '测试', stepLimit: 101 })).toThrow();
  });

  it('只接受明确的重放模式', () => {
    expect(() => runBodySchema.parse({ caseId: 'case-1', mode: 'unknown' })).toThrow();
  });
});
