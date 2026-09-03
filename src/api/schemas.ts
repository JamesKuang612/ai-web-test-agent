import { z } from 'zod';

export const caseIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, '用例 ID 格式无效');

const agentConfigSchema = z.object({
  model: z.string().optional(),
  reasoningEffort: z.string().optional(),
});

export const exploreBodySchema = agentConfigSchema.extend({
  caseId: caseIdSchema,
  instruction: z.string().trim().min(1, '测试用例不能为空').max(200_000),
  strategy: z.enum(['codex-only', 'midscene-only']).default('codex-only'),
  stepLimit: z.number().int().min(1).max(100).default(20),
});

export const generateBodySchema = agentConfigSchema.extend({ caseId: caseIdSchema });

export const runBodySchema = agentConfigSchema.extend({
  caseId: caseIdSchema,
  mode: z.enum(['agent', 'script']),
});

export const caseParamsSchema = z.object({ caseId: caseIdSchema });
export const jobParamsSchema = z.object({ jobId: z.string().min(1).max(200) });
