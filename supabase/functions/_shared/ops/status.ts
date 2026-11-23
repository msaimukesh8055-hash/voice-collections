// supabase/functions/_shared/ops/status.ts
// The ops page's top half (redesign, Saim 2026-11-23), worked out from raw counts: is the app
// up (health probes), uptime since probing began, service targets met or missed, the outside
// services as our own calls saw them, and the scheduled jobs. Every number carries a one-line
// "how it's calculated", and nothing is assumed before the first probe: uptime is "measured
// since" that probe, and a target with no data says so instead of passing.
import type {
  CronJob,
  JobRequests,
  OpsStatusRow,
  OpsSummary,
  ServiceUse,
} from '../db/ops-repository.ts';

const PROBE_EVERY_MS = 5 * 60_000;
/** A probe older than two missed probes means the probing itself has stopped. */
const STALE_AFTER_MS = 12 * 60_000;
const DAY_MS = 24 * 3_600_000;
const WEEK_MS = 7 * DAY_MS;
/** A timer counts as on time when this share of pg_cron's runs reached the worker. */
const REACHED_SHARE = 0.95;

export type Tone = 'good' | 'warn' | 'bad' | 'plain';

export interface Uptime {
  readonly percent: number;
  readonly ok: number;
  /** Probes that should have run in the window (5-minute slots), or more if more ran. */
  readonly expected: number;
}

export interface Target {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  readonly now: string;
  /** Null when there is no data yet: neither met nor missed. */
  readonly met: boolean | null;
  readonly how: string;
}

export interface Service {
  readonly name: string;
  readonly use: string;
  readonly calls: number;
  readonly failed: number;
  readonly lastFailedAt: string | null;
  readonly state: 'ok' | 'recovered' | 'failing' | 'idle' | 'unknown';
  readonly how: string;
}

export interface Job {
  readonly name: string;
  readonly what: string;
  readonly when: string;
  readonly lastRunAt: string | null;
  readonly dayRuns: number;
  /** Runs that reached the follow-up worker (timers only); null for SQL-only jobs. */
  readonly dayReached: number | null;
  readonly state: 'ok' | 'late' | 'failing' | 'off' | 'not_run';
  readonly note: string;
}

export interface OpsStatusView {
  /** The first health probe; uptime before it is not known. */
  readonly measuredSince: string | null;
  readonly now: {
    readonly state: 'up' | 'down' | 'stale' | 'unknown';
    readonly checkedAt: string | null;
    readonly durationMs: number | null;
    readonly version: string | null;
  };
  readonly uptime: {
    readonly day: Uptime | null;
    readonly week: Uptime | null;
    readonly all: Uptime | null;
  };
  readonly targets: readonly Target[];
  readonly services: readonly Service[];
  readonly jobs: readonly Job[];
  readonly errorGroups: OpsStatusRow['errorGroups'];
}

export interface StatusInput {
  readonly row: OpsStatusRow;
  readonly summary: OpsSummary;
  readonly spend: { readonly monthInr: number; readonly capInr: number };
  readonly toolTargetMs: number;
  readonly now: Date;
}

function uptimeOf(
  counts: { readonly total: number; readonly ok: number },
  since: { readonly firstAt: string | null; readonly windowMs: number; readonly now: Date },
): Uptime | null {
  if (!since.firstAt || counts.total === 0) return null;
  const first = Date.parse(since.firstAt);
  const windowStart = since.now.getTime() - since.windowMs;
  // A full window has one slot per 5 minutes; a younger one counts the first probe too.
  const slots = first < windowStart
    ? Math.floor(since.windowMs / PROBE_EVERY_MS)
    : Math.floor((since.now.getTime() - first) / PROBE_EVERY_MS) + 1;
  const expected = Math.max(slots, counts.total);
  return { percent: Math.floor((counts.ok / expected) * 10_000) / 100, ok: counts.ok, expected };
}

function nowState(row: OpsStatusRow, now: Date): OpsStatusView['now'] {
  const last = row.lastProbe;
  if (!last) return { state: 'unknown', checkedAt: null, durationMs: null, version: null };
  const stale = now.getTime() - Date.parse(last.checkedAt) > STALE_AFTER_MS;
  return {
    state: stale ? 'stale' : last.ok ? 'up' : 'down',
    checkedAt: last.checkedAt,
    durationMs: last.durationMs,
    version: last.version,
  };
}

export function uptimes(row: OpsStatusRow, now: Date): OpsStatusView['uptime'] {
  const { probes } = row;
  const firstAt = probes.firstAt;
  return {
    day: uptimeOf({ total: probes.dayTotal, ok: probes.dayOk }, { firstAt, windowMs: DAY_MS, now }),
    week: uptimeOf({ total: probes.weekTotal, ok: probes.weekOk }, {
      firstAt,
      windowMs: WEEK_MS,
      now,
    }),
    all: uptimeOf({ total: probes.allTotal, ok: probes.allOk }, {
      firstAt,
      windowMs: Number.POSITIVE_INFINITY,
      now,
    }),
  };
}

// ---- Scheduled jobs ---------------------------------------------------------------------------

interface JobInfo {
  readonly what: string;
  readonly when: string;
  /** The worker route a timer calls; null for a job that is SQL only. */
  readonly route: string | null;
}

/** What each pg_cron job is for, in plain words (schedules are UTC in pg_cron). */
export const JOB_INFO: Readonly<Record<string, JobInfo>> = {
  'followup-sweep': {
    what: 'Due follow-ups and queued simulated calls',
    when: 'Every minute',
    route: '/sweep',
  },
  'ops-watch': {
    what: 'Alerts the ops number about new failures',
    when: 'Every 5 minutes',
    route: '/ops-watch',
  },
  'health-probe': {
    what: 'Health check of the app API and database',
    when: 'Every 5 minutes',
    route: '/health-probe',
  },
  'daily-promise-check': {
    what: 'Marks promises kept or broken',
    when: 'Daily, 8:45 am India time',
    route: '/promise-check',
  },
  'daily-due-alert': {
    what: 'Due alert to the owner on WhatsApp',
    when: 'Daily, 9:00 am India time',
    route: '/daily-alert',
  },
  'ops-events-retention': {
    what: 'Deletes ops events older than 14 days',
    when: 'Daily, 1:40 am India time',
    route: null,
  },
  'wa-exchanges-retention': {
    what: 'Deletes WhatsApp message text older than 30 days',
    when: 'Daily, 1:50 am India time',
    route: null,
  },
  'health-checks-retention': {
    what: 'Deletes health probes older than 90 days',
    when: 'Daily, 2:00 am India time',
    route: null,
  },
};

function jobState(
  job: CronJob,
  reached: JobRequests | undefined,
  route: string | null,
): Job['state'] {
  if (!job.active) return 'off';
  if (job.dayFailed > 0 || job.lastStatus === 'failed' || (reached?.dayFailed ?? 0) > 0) {
    return 'failing';
  }
  if (!job.lastRunAt && !reached?.lastAt) return 'not_run';
  if (route && job.dayRuns > 0 && (reached?.dayRuns ?? 0) < job.dayRuns * REACHED_SHARE) {
    return 'late';
  }
  return 'ok';
}

function jobNote(job: CronJob, reached: JobRequests | undefined, route: string | null): string {
  const failed = job.dayFailed > 0 ? `${job.dayFailed} failed in pg_cron. ` : '';
  if (!route) return `${failed}SQL only: pg_cron's own run record.`;
  const worker = reached?.dayFailed ? ` ${reached.dayFailed} failed in the worker.` : '';
  const got = reached?.dayRuns ?? 0;
  if (got > job.dayRuns) {
    return `${failed}pg_cron ran it ${job.dayRuns} times; the worker got ${got} (the rest were ` +
      `started by our own code).${worker}`;
  }
  return `${failed}${got} of ${job.dayRuns} runs reached the worker.${worker}`;
}

export function jobsOf(row: OpsStatusRow): readonly Job[] {
  return row.jobs.map((job) => {
    const info = JOB_INFO[job.name];
    const route = info?.route ?? null;
    const reached = row.jobRequests.find((one) => one.route === route);
    return {
      name: job.name,
      what: info?.what ?? 'Not described yet',
      when: info?.when ?? `pg_cron "${job.schedule}" (UTC)`,
      lastRunAt: job.lastRunAt ?? reached?.lastAt ?? null,
      dayRuns: job.dayRuns,
      dayReached: route ? reached?.dayRuns ?? 0 : null,
      state: jobState(job, reached, route),
      note: jobNote(job, reached, route),
    };
  });
}

// ---- Outside services -------------------------------------------------------------------------

function serviceState(use: ServiceUse): Service['state'] {
  if (use.calls === 0) return 'idle';
  if (use.failed === 0) return 'ok';
  const okAfter = use.lastOkAt !== null && use.lastFailedAt !== null &&
    use.lastOkAt > use.lastFailedAt;
  return okAfter ? 'recovered' : 'failing';
}

const NO_USE: ServiceUse = { calls: 0, failed: 0, lastOkAt: null, lastFailedAt: null };

function providerUse(row: OpsStatusRow, provider: string): ServiceUse {
  return row.providers.find((one) => one.provider === provider) ?? NO_USE;
}

function service(
  head: Pick<Service, 'name' | 'use' | 'how'>,
  use: ServiceUse,
): Service {
  return {
    ...head,
    calls: use.calls,
    failed: use.failed,
    lastFailedAt: use.lastFailedAt,
    state: serviceState(use),
  };
}

function databaseService(row: OpsStatusRow): Service {
  const database = row.lastProbe?.database ?? null;
  const state: Service['state'] = database === null
    ? 'unknown'
    : database === 'ok'
    ? 'ok'
    : 'failing';
  return {
    name: 'Supabase database',
    use: 'The book, calls and everything the agents read and write',
    calls: row.probes.weekTotal,
    failed: row.probes.weekTotal - row.probes.weekOk,
    lastFailedAt: null,
    state,
    how: 'Every health probe reads the database; state is the latest probe. Failed counts every ' +
      'probe that did not get a 200, whatever the cause.',
  };
}

function whatsappService(row: OpsStatusRow): Service {
  const { repliesSent, repliesFailed, sendFailures, lastOkAt, lastFailedAt } = row.whatsapp;
  const use: ServiceUse = {
    calls: repliesSent + repliesFailed,
    failed: Math.max(repliesFailed, sendFailures),
    lastOkAt,
    lastFailedAt,
  };
  return service({
    name: 'Meta WhatsApp',
    use: 'Every message to and from the owner',
    how: `Calls: the bot's replies to the owner's messages (7 days). Failed: the larger of ` +
      `failed replies (${repliesFailed}) and send failures logged anywhere (${sendFailures}).`,
  }, use);
}

export function servicesOf(row: OpsStatusRow): readonly Service[] {
  return [
    databaseService(row),
    service({
      name: 'Sarvam LLM (sarvam-105b)',
      use: 'WhatsApp brain, follow-up agent, simulated calls',
      how: 'Our calls to the model in 7 days, eval traffic left out. A badly shaped answer still ' +
        'reached Sarvam, so it is not a failure here (it is under Rejected LLM answers).',
    }, providerUse(row, 'sarvam')),
    service({
      name: 'Gemini',
      use: 'Fallback when Sarvam fails',
      how: 'Our fallback calls to Gemini in 7 days, eval traffic left out. Idle is normal: it ' +
        'is only asked when Sarvam fails. The call tone judge also uses Gemini; not counted here.',
    }, providerUse(row, 'gemini')),
    service({
      name: 'Sarvam voice agents',
      use: 'Asha and Munshi browser calls',
      how: 'Each call starts with our API asking Sarvam for a call link; failed is Sarvam ' +
        'answering with an error (7 days).',
    }, row.voice),
    whatsappService(row),
  ];
}

// ---- Service targets --------------------------------------------------------------------------

function percentText(value: number): string {
  return `${value.toFixed(value >= 99 ? 2 : 1)}%`;
}

function uptimeTarget(week: Uptime | null): Target {
  return {
    id: 'uptime',
    name: 'App API up',
    goal: '99.5% of probes, 7 days',
    now: week
      ? `${percentText(week.percent)} (${week.ok} of ${week.expected})`
      : 'Not measured yet',
    met: week ? week.percent >= 99.5 : null,
    how: 'Health probes that got a 200, out of every 5-minute slot since the first probe in the ' +
      'window. A probe that never ran counts as down.',
  };
}

function requestsTarget(summary: OpsSummary): Target {
  const { requests, failed } = summary.week;
  const share = requests === 0 ? null : ((requests - failed) / requests) * 100;
  return {
    id: 'requests',
    name: 'Requests that worked',
    goal: '99%, 7 days',
    now: share === null
      ? 'No requests'
      : `${percentText(share)} (${requests - failed} of ${requests})`,
    met: share === null ? null : share >= 99,
    how: 'Requests to our five functions whose trace has no error step, eval traffic left out.',
  };
}

function whatsappTarget(row: OpsStatusRow): Target {
  const { messages, p95Ms } = row.waReply;
  return {
    id: 'whatsapp',
    name: 'WhatsApp message handled',
    goal: 'p95 under 5 s, 7 days',
    now: p95Ms === null ? 'No messages' : `${(p95Ms / 1000).toFixed(1)} s (${messages} messages)`,
    met: p95Ms === null ? null : p95Ms < 5_000,
    how: 'Time from the message reaching us to the reply being handed to Meta, 95% of messages ' +
      'at or under this. Test messages left out.',
  };
}

function toolsTarget(summary: OpsSummary, targetMs: number): Target {
  const over = summary.tools.filter((tool) => tool.p95Ms >= targetMs);
  return {
    id: 'tools',
    name: 'Agent tool replies',
    goal: `p95 under ${targetMs} ms, every tool`,
    now: summary.tools.length === 0
      ? 'No tool calls'
      : `${summary.tools.length - over.length} of ${summary.tools.length} tools within`,
    met: summary.tools.length === 0 ? null : over.length === 0,
    how: "Server time for each of Asha's and Munshi's tools over 7 days (details folded below).",
  };
}

function jobsTarget(jobs: readonly Job[]): Target {
  const judged = jobs.filter((job) => job.state !== 'off' && job.state !== 'not_run');
  const behind = judged.filter((job) => job.state !== 'ok');
  const waiting = jobs.length - judged.length;
  const notYet = waiting > 0 ? `, ${waiting} not run yet or off` : '';
  return {
    id: 'jobs',
    name: 'Scheduled jobs on time',
    goal: 'Every job, last 24 h',
    now: judged.length === 0
      ? 'No job has run yet'
      : `${judged.length - behind.length} of ${judged.length} on time${notYet}`,
    met: judged.length === 0 ? null : behind.length === 0,
    how: `On time: no failed run, and at least ${REACHED_SHARE * 100}% of pg_cron's runs reached ` +
      'the worker.',
  };
}

export function targetsOf(
  input: StatusInput,
  parts: { readonly week: Uptime | null; readonly jobs: readonly Job[] },
): readonly Target[] {
  const { summary, spend } = input;
  return [
    uptimeTarget(parts.week),
    requestsTarget(summary),
    whatsappTarget(input.row),
    toolsTarget(summary, input.toolTargetMs),
    jobsTarget(parts.jobs),
    {
      id: 'queue',
      name: 'Follow-ups stuck',
      goal: 'None',
      now: `${summary.followups.stuck} stuck, ${summary.followups.waiting} waiting`,
      met: summary.followups.stuck === 0,
      how: 'A follow-up due or running for more than 10 minutes counts as stuck.',
    },
    {
      id: 'spend',
      name: 'Spend this month',
      goal: `Under ₹${spend.capInr}`,
      now: `₹${spend.monthInr.toFixed(2)}`,
      met: spend.monthInr < spend.capInr,
      how:
        'Voice minutes × ₹3.50 + GST, plus LLM tokens × the price list (same as the spend tile).',
    },
  ];
}

export function buildStatus(input: StatusInput): OpsStatusView {
  const uptime = uptimes(input.row, input.now);
  const jobs = jobsOf(input.row);
  return {
    measuredSince: input.row.probes.firstAt,
    now: nowState(input.row, input.now),
    uptime,
    targets: targetsOf(input, { week: uptime.week, jobs }),
    services: servicesOf(input.row),
    jobs,
    errorGroups: input.row.errorGroups,
  };
}
