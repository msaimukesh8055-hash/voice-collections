// supabase/functions/_shared/db/ops-status-row.ts
// ops_status()'s JSON (ops redesign, 2026-11-23), checked and turned into OpsStatusRow. A drift
// between the SQL and the page fails loudly here, in one place.
import { z } from 'zod';
import type { OpsStatusRow } from './ops-repository.ts';

const Count = z.coerce.number().int().nonnegative();
const Time = z.string().nullable();
const Ms = z.number().int().nullable();

const Use = z.object({
  calls: Count,
  failed: Count,
  last_ok_at: Time,
  last_failed_at: Time,
});

const StatusJson = z.object({
  probes: z.object({
    first_at: Time,
    day_total: Count,
    day_ok: Count,
    week_total: Count,
    week_ok: Count,
    all_total: Count,
    all_ok: Count,
    week_p95_ms: Ms,
  }),
  last_probe: z.object({
    checked_at: z.string(),
    ok: z.boolean(),
    status_code: Ms,
    duration_ms: Count,
    database: z.enum(['ok', 'fail']).nullable(),
    version: z.string().nullable(),
    error_code: z.string().nullable(),
  }).nullable(),
  job_requests: z.array(z.object({
    route: z.string(),
    day_runs: Count,
    day_failed: Count,
    week_runs: Count,
    last_at: Time,
  })),
  jobs: z.array(z.object({
    name: z.string(),
    schedule: z.string(),
    active: z.boolean(),
    last_run_at: Time,
    last_status: z.string().nullable(),
    day_runs: Count,
    day_failed: Count,
  })),
  error_groups: z.array(z.object({
    source: z.string(),
    step: z.string(),
    error_code: z.string().nullable(),
    count: Count,
    last_at: z.string(),
    trace_id: z.string(),
  })),
  providers: z.array(Use.extend({ provider: z.string() })),
  voice: Use,
  whatsapp: z.object({
    replies_sent: Count,
    replies_failed: Count,
    /** Added in 20261123000002; null before that migration. */
    last_ok_at: Time.optional().default(null),
    send_failures: Count,
    last_failed_at: Time,
  }),
  wa_reply: z.object({ messages: Count, p50_ms: Ms, p95_ms: Ms }),
});
type StatusJson = z.infer<typeof StatusJson>;

function use(row: z.infer<typeof Use>): OpsStatusRow['voice'] {
  return {
    calls: row.calls,
    failed: row.failed,
    lastOkAt: row.last_ok_at,
    lastFailedAt: row.last_failed_at,
  };
}

function probesOf(row: StatusJson['probes']): OpsStatusRow['probes'] {
  return {
    firstAt: row.first_at,
    dayTotal: row.day_total,
    dayOk: row.day_ok,
    weekTotal: row.week_total,
    weekOk: row.week_ok,
    allTotal: row.all_total,
    allOk: row.all_ok,
    weekP95Ms: row.week_p95_ms,
  };
}

function lastProbeOf(row: StatusJson['last_probe']): OpsStatusRow['lastProbe'] {
  if (!row) return null;
  return {
    checkedAt: row.checked_at,
    ok: row.ok,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    database: row.database,
    version: row.version,
    errorCode: row.error_code,
  };
}

function timersOf(row: StatusJson): Pick<OpsStatusRow, 'jobRequests' | 'jobs'> {
  return {
    jobRequests: row.job_requests.map((one) => ({
      route: one.route,
      dayRuns: one.day_runs,
      dayFailed: one.day_failed,
      weekRuns: one.week_runs,
      lastAt: one.last_at,
    })),
    jobs: row.jobs.map((one) => ({
      name: one.name,
      schedule: one.schedule,
      active: one.active,
      lastRunAt: one.last_run_at,
      lastStatus: one.last_status,
      dayRuns: one.day_runs,
      dayFailed: one.day_failed,
    })),
  };
}

function servicesOf(row: StatusJson): Pick<OpsStatusRow, 'providers' | 'voice' | 'whatsapp'> {
  return {
    providers: row.providers.map((one) => ({ provider: one.provider, ...use(one) })),
    voice: use(row.voice),
    whatsapp: {
      repliesSent: row.whatsapp.replies_sent,
      repliesFailed: row.whatsapp.replies_failed,
      lastOkAt: row.whatsapp.last_ok_at,
      sendFailures: row.whatsapp.send_failures,
      lastFailedAt: row.whatsapp.last_failed_at,
    },
  };
}

export function parseStatusRow(raw: unknown): OpsStatusRow {
  const row = StatusJson.parse(raw);
  return {
    probes: probesOf(row.probes),
    lastProbe: lastProbeOf(row.last_probe),
    ...timersOf(row),
    errorGroups: row.error_groups.map((one) => ({
      source: one.source,
      step: one.step,
      errorCode: one.error_code,
      count: one.count,
      lastAt: one.last_at,
      traceId: one.trace_id,
    })),
    ...servicesOf(row),
    waReply: {
      messages: row.wa_reply.messages,
      p50Ms: row.wa_reply.p50_ms,
      p95Ms: row.wa_reply.p95_ms,
    },
  };
}
