// web/src/lib/modelChoiceSchemas.ts
// The Evals page's "Model choice" table (Saim, 2026-11-23): the latest bake-off run per model
// (npm run evals:bakeoff, stored as eval runs with target "brain-model"). Each field defaults to
// something harmless, so an odd run shows as zeros, never as a crash.
import { z } from 'zod';

const ModelRunSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  metrics: z.object({
    model: z.string().catch('unknown'),
    provider: z.string().catch('unknown'),
    cases: z.number().catch(0),
    casesPassed: z.number().catch(0),
    moneyCases: z.number().catch(0),
    moneyFailures: z.number().catch(0),
    indicCases: z.number().catch(0),
    indicPassed: z.number().catch(0),
    failedCalls: z.number().catch(0),
    p50Ms: z.number().catch(0),
    maxMs: z.number().catch(0),
    avgTokensIn: z.number().catch(0),
    avgTokensOut: z.number().catch(0),
    costPer1000Inr: z.number().catch(0),
    priceNote: z.string().catch(''),
    passed: z.boolean().catch(false),
    reasons: z.array(z.string()).catch([]),
  }),
});

export const ModelChoiceSchema = z.array(ModelRunSchema).catch([]).default([]);

export type ModelRun = z.infer<typeof ModelRunSchema>;
