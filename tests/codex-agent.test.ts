import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { writableRootFor } from '../src/agents/codex-agent.js';

describe('Codex 生成权限', () => {
  it('把当前 case 目录作为最小可写根，而不是单个 spec 文件', () => {
    const script = path.join('cases', 'case-1', 'playwright.spec.ts');
    const root = writableRootFor(script);
    expect(root.endsWith('/cases/case-1')).toBe(true);
    expect(root).not.toContain('playwright.spec.ts');
  });
});
