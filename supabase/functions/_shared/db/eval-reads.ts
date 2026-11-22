// supabase/functions/_shared/db/eval-reads.ts
// What the dashboard's Evals page reads (M9 Build C4): the stored eval runs (Asha on Sarvam
// Tests, the WhatsApp brain's code checks) and the case results of one run. Read-only, service
// role. Eval data is fake by construction (evals/sarvam/eval-data.ts), so transcripts are shown.
import { z } from 'zod';
import type { PostgrestClient } from './postgrest.ts';

const RUN_COLUMNS = 'id,target,prompt_hash,metrics,created_at';
const RESULT_COLUMNS = 'scenario_id,scores,transcript,pass';
/** A run has at most a few dozen cases. */
const MAX_RESULTS = 100;

export interface EvalRun {
  readonly id: string;
  /** "asha" or "brain". */
  readonly target: string;
  readonly promptHash: string;
  /** The run's summary as its runner stored it (gate, counts, versions). */
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface EvalCaseResult {
  readonly scenarioId: string;
  readonly scores: Readonly<Record<string, unknown>>;
  readonly transcript: string;
  readonly pass: boolean;
}

/** One case's pass or fail in one run, without the transcript (the case history grid). */
export interface EvalOutcome {
  readonly runId: string;
  readonly scenarioId: string;
  readonly name: string;
  readonly pass: boolean;
}

export interface EvalReads {
  /** Newest first. */
  listRuns(limit: number): Promise<readonly EvalRun[]>;
  listResults(runId: string): Promise<readonly EvalCaseResult[]>;
  /** Pass or fail for every case of these runs (2026-11-22, "How it got fixed"). */
  listOutcomes(runIds: readonly string[]): Promise<readonly EvalOutcome[]>;
  /** One case of one run, with its conversation; null when not stored. */
  getResult(runId: string, scenarioId: string): Promise<EvalCaseResult | null>;
}

const JsonObject = z.record(z.string(), z.unknown()).catch({});
const RunRow = z.object({
  id: z.uuid(),
  target: z.string(),
  prompt_hash: z.string(),
  metrics: JsonObject,
  created_at: z.string(),
}).transform((row): EvalRun => ({
  id: row.id,
  target: row.target,
  promptHash: row.prompt_hash,
  metrics: row.metrics,
  createdAt: row.created_at,
}));
const ResultRow = z.object({
  scenario_id: z.string(),
  scores: JsonObject,
  transcript: z.string(),
  pass: z.boolean(),
}).transform((row): EvalCaseResult => ({
  scenarioId: row.scenario_id,
  scores: row.scores,
  transcript: row.transcript,
  pass: row.pass,
}));

const OutcomeRow = z.object({
  run_id: z.string(),
  scenario_id: z.string(),
  name: z.string().nullable(),
  pass: z.boolean(),
}).transform((row): EvalOutcome => ({
  runId: row.run_id,
  scenarioId: row.scenario_id,
  name: row.name ?? '',
  pass: row.pass,
}));
/** Up to 10 runs of a few dozen cases each. */
const MAX_OUTCOMES = 1000;

export function createEvalReads(query: PostgrestClient): EvalReads {
  return {
    async listOutcomes(runIds): Promise<readonly EvalOutcome[]> {
      if (runIds.length === 0) return [];
      const ids = runIds.map(encodeURIComponent).join(',');
      const path = `eval_results?select=run_id,scenario_id,name:scores->>name,pass` +
        `&run_id=in.(${ids})&limit=${MAX_OUTCOMES}`;
      return z.array(OutcomeRow).parse((await query('listEvalOutcomes', path)).rows);
    },
    async getResult(runId, scenarioId): Promise<EvalCaseResult | null> {
      const path = `eval_results?select=${RESULT_COLUMNS}&run_id=eq.${encodeURIComponent(runId)}` +
        `&scenario_id=eq.${encodeURIComponent(scenarioId)}&limit=1`;
      const rows = z.array(ResultRow).parse((await query('getEvalResult', path)).rows);
      return rows[0] ?? null;
    },
    async listRuns(limit): Promise<readonly EvalRun[]> {
      const path = `eval_runs?select=${RUN_COLUMNS}&order=created_at.desc&limit=${limit}`;
      return z.array(RunRow).parse((await query('listEvalRuns', path)).rows);
    },
    async listResults(runId): Promise<readonly EvalCaseResult[]> {
      const path = `eval_results?select=${RESULT_COLUMNS}&run_id=eq.${encodeURIComponent(runId)}` +
        `&order=scenario_id&limit=${MAX_RESULTS}`;
      return z.array(ResultRow).parse((await query('listEvalResults', path)).rows);
    },
  };
}
