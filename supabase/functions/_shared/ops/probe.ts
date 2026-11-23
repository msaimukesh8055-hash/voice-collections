// supabase/functions/_shared/ops/probe.ts
// The health probe (ops redesign, Saim 2026-11-23). Every 5 minutes pg_cron asks the follow-up
// worker to call the app API's /v1/health, which reads the database, and the answer is written
// to health_checks. The ops page's uptime is the share of probes that came back 200; a probe
// that never ran counts as down there, so a dead timer cannot look like uptime.
import { z } from 'zod';
import { errorName, type Logger } from '../log.ts';

/** Long enough for a cold start, short enough to finish before the next probe. */
export const PROBE_TIMEOUT_MS = 10_000;
const MAX_TEXT = 100;

export interface HealthCheck {
  readonly ok: boolean;
  /** Null when no answer came back. */
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly database: 'ok' | 'fail' | null;
  readonly version: string | null;
  /** Why there was no answer (an error class name), never a message body. */
  readonly errorCode: string | null;
}

export interface ProbeDeps {
  readonly healthUrl: string;
  /** Supabase's public anon key; calls-api's JWT check wants it. */
  readonly anonKey: string | null;
  readonly fetchImpl: typeof fetch;
  readonly now: () => number;
  readonly record: (check: HealthCheck) => Promise<void>;
  readonly log: Logger;
}

const HealthBody = z.object({
  checks: z.object({ database: z.enum(['ok', 'fail']) }).partial().catch({}),
  version: z.string().catch('unknown'),
}).partial();

/** calls-api's /v1/health, from the project URL every function is given. */
export function healthUrlOf(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/calls-api/v1/health`;
}

async function bodyOf(response: Response): Promise<z.infer<typeof HealthBody>> {
  try {
    return HealthBody.catch({}).parse(await response.json());
  } catch {
    return {};
  }
}

async function ask(deps: ProbeDeps): Promise<Omit<HealthCheck, 'durationMs'>> {
  const headers: Record<string, string> = deps.anonKey
    ? { Authorization: `Bearer ${deps.anonKey}`, apikey: deps.anonKey }
    : {};
  try {
    const response = await deps.fetchImpl(deps.healthUrl, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = await bodyOf(response);
    return {
      ok: response.status === 200,
      statusCode: response.status,
      database: body.checks?.database ?? null,
      version: body.version?.slice(0, MAX_TEXT) ?? null,
      errorCode: null,
    };
  } catch (error) {
    const code = errorName(error).slice(0, MAX_TEXT);
    return { ok: false, statusCode: null, database: null, version: null, errorCode: code };
  }
}

/** One probe: call, time, record. A failed probe is logged as an error, so ops-watch alerts. */
export async function runHealthProbe(deps: ProbeDeps): Promise<HealthCheck> {
  const started = deps.now();
  const answer = await ask(deps);
  const check: HealthCheck = { ...answer, durationMs: Math.max(0, deps.now() - started) };
  await deps.record(check);
  if (!check.ok) {
    deps.log('error', 'health_probe_failed', {
      status: check.statusCode,
      error: check.errorCode,
      database: check.database,
    });
  }
  return check;
}
