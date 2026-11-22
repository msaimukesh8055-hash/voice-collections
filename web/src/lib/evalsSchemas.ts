// web/src/lib/evalsSchemas.ts
// Shape of the Evals page's reply (M9 Build C4). The run summary and each case's scores are
// stored by the eval runners; every field the page shows is checked here and defaults to
// something harmless, so an older or odd run shows as "unknown", never as a crash.
import { z } from 'zod';

const VerdictSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  reasoning: z.string().catch(''),
});
const CheckSchema = z.object({
  id: z.string(),
  critical: z.boolean().catch(false),
  passed: z.boolean(),
  detail: z.string().catch(''),
});
const MetricsSchema = z.object({
  kind: z.string().catch('unknown'),
  passed: z.boolean().catch(false),
  reasons: z.array(z.string()).catch([]),
  cases: z.number().catch(0),
  casesPassed: z.number().catch(0),
  behaviours: z.number().optional().catch(undefined),
  behavioursPassed: z.number().optional().catch(undefined),
  guardrailFailures: z.number().optional().catch(undefined),
  criticalFailures: z.number().optional().catch(undefined),
  moneyFailures: z.number().optional().catch(undefined),
  promptVersion: z.string().optional().catch(undefined),
  appVersion: z.number().optional().catch(undefined),
});
const RunSchema = z.object({
  id: z.string(),
  target: z.string(),
  promptHash: z.string(),
  metrics: MetricsSchema,
  createdAt: z.string(),
});
const CaseSchema = z.object({
  scenarioId: z.string(),
  scores: z.object({
    name: z.string().catch(''),
    category: z.string().catch(''),
    verdicts: z.array(VerdictSchema).catch([]),
    checks: z.array(CheckSchema).catch([]),
  }),
  transcript: z.string(),
  pass: z.boolean(),
});

/** "How it got fixed" (2026-11-22): each case across the recent runs, oldest run first. */
const HistoryRunSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  promptHash: z.string(),
  passed: z.boolean(),
  casesPassed: z.number(),
  cases: z.number(),
  appVersion: z.number().nullable(),
  promptChanged: z.boolean(),
  change: z.enum(['first', 'prompt', 'code', 'test', 'rerun']).catch('rerun'),
  note: z.string().nullable(),
});
const HistoryCaseSchema = z.object({
  scenarioId: z.string(),
  name: z.string(),
  results: z.record(z.string(), z.boolean()),
  fixedIn: z.string().nullable(),
  lastFailedIn: z.string().nullable(),
});
const CaseHistorySchema = z.object({
  runs: z.array(HistoryRunSchema),
  cases: z.array(HistoryCaseSchema),
});

export const EvalsSchema = z.object({
  targets: z.array(
    z.object({
      target: z.string(),
      latest: RunSchema,
      cases: z.array(CaseSchema),
      history: z.array(RunSchema),
      caseHistory: CaseHistorySchema.default({ runs: [], cases: [] }),
    }),
  ),
  generatedAt: z.string(),
});

/** One case of one run, with its conversation (the before / after view). */
export const EvalCaseReplySchema = z.object({ result: CaseSchema });

export type Evals = z.infer<typeof EvalsSchema>;
export type EvalTarget = Evals['targets'][number];
export type EvalRun = EvalTarget['latest'];
export type EvalCase = EvalTarget['cases'][number];
export type CaseHistory = EvalTarget['caseHistory'];
export type HistoryRun = CaseHistory['runs'][number];
export type HistoryCase = CaseHistory['cases'][number];
