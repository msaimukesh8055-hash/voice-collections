// supabase/functions/_shared/ops/status.test.ts
// The ops page's status: uptime counts missing probes as down and starts at the first probe,
// timers compare pg_cron's runs with what reached the worker, services and targets say when
// there is no data instead of passing.
import { assertEquals } from '@std/assert';
import { EMPTY_OPS_STATUS } from '../db/fake-ops-repository.ts';
import { EMPTY_OPS_SUMMARY } from '../db/fake-ops-repository.ts';
import type { CronJob, OpsStatusRow } from '../db/ops-repository.ts';
import { buildStatus, jobsOf, servicesOf, type StatusInput, uptimes } from './status.ts';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const HOUR = 3_600_000;

function withProbes(probes: Partial<OpsStatusRow['probes']>): OpsStatusRow {
  return { ...EMPTY_OPS_STATUS, probes: { ...EMPTY_OPS_STATUS.probes, ...probes } };
}

function input(row: OpsStatusRow): StatusInput {
  return {
    row,
    summary: EMPTY_OPS_SUMMARY,
    spend: { monthInr: 12.5, capInr: 1000 },
    now: NOW,
  };
}

Deno.test('uptime › no probe yet: not measured, and the target is neither met nor missed', () => {
  const status = buildStatus(input(EMPTY_OPS_STATUS));
  assertEquals(status.uptime, { day: null, week: null, all: null });
  assertEquals(status.measuredSince, null);
  assertEquals(status.now.state, 'unknown');
  const target = status.targets.find((one) => one.id === 'uptime');
  assertEquals([target?.now, target?.met], ['Not measured yet', null]);
});

Deno.test('uptime › starts at the first probe; a missing probe counts as down', () => {
  // First probe 1 hour ago: 13 slots (the first probe plus 12 more). Only 12 ran, all fine.
  const firstAt = new Date(NOW.getTime() - HOUR).toISOString();
  const row = withProbes({ firstAt, dayTotal: 12, dayOk: 12, allTotal: 12, allOk: 12 });
  const { day, all } = uptimes(row, NOW);
  assertEquals(day, { percent: 92.3, ok: 12, expected: 13 });
  assertEquals(all, day);
});

Deno.test('uptime › a full day has 288 slots; a perfect day is 100%, never rounded up', () => {
  const firstAt = new Date(NOW.getTime() - 3 * 24 * HOUR).toISOString();
  const perfect = uptimes(withProbes({ firstAt, dayTotal: 288, dayOk: 288 }), NOW).day;
  assertEquals(perfect, { percent: 100, ok: 288, expected: 288 });
  const oneDown = uptimes(withProbes({ firstAt, dayTotal: 288, dayOk: 287 }), NOW).day;
  assertEquals(oneDown?.percent, 99.65);
});

Deno.test('now › up, down, or stale when probing itself stopped', () => {
  const at = (minutesAgo: number, ok: boolean): OpsStatusRow => ({
    ...EMPTY_OPS_STATUS,
    lastProbe: {
      checkedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
      ok,
      statusCode: ok ? 200 : 503,
      durationMs: 140,
      database: ok ? 'ok' : 'fail',
      version: 'abc',
      errorCode: null,
    },
  });
  assertEquals(buildStatus(input(at(3, true))).now.state, 'up');
  assertEquals(buildStatus(input(at(3, false))).now.state, 'down');
  assertEquals(buildStatus(input(at(30, true))).now.state, 'stale');
});

const SWEEP: CronJob = {
  name: 'followup-sweep',
  schedule: '* * * * *',
  active: true,
  lastRunAt: '2026-11-23T11:59:00.000Z',
  lastStatus: 'succeeded',
  dayRuns: 1440,
  dayFailed: 0,
};

function reached(dayRuns: number, dayFailed = 0): OpsStatusRow['jobRequests'][number] {
  return { route: '/sweep', dayRuns, dayFailed, weekRuns: dayRuns * 7, lastAt: SWEEP.lastRunAt };
}

Deno.test('jobs › on time when pg_cron ran it and the runs reached the worker', () => {
  const [job] = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [SWEEP], jobRequests: [reached(1440)] });
  assertEquals(job?.state, 'ok');
  assertEquals(job?.when, 'Every minute');
  assertEquals(job?.note, '1440 of 1440 runs reached the worker.');
});

Deno.test('jobs › late when runs never reached the worker; failing on a failed run', () => {
  const late = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [SWEEP], jobRequests: [reached(1000)] });
  assertEquals(late[0]?.state, 'late');
  const workerFailed = jobsOf({
    ...EMPTY_OPS_STATUS,
    jobs: [SWEEP],
    jobRequests: [reached(1440, 2)],
  });
  assertEquals(workerFailed[0]?.state, 'failing');
  const cronFailed = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [{ ...SWEEP, dayFailed: 1 }] });
  assertEquals(cronFailed[0]?.state, 'failing');
  const off = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [{ ...SWEEP, active: false }] });
  assertEquals(off[0]?.state, 'off');
});

Deno.test('jobs › a SQL-only clean-up is judged on pg_cron alone; an unknown job is still listed', () => {
  const cleanup: CronJob = { ...SWEEP, name: 'ops-events-retention', dayRuns: 1 };
  const other: CronJob = { ...SWEEP, name: 'something-new', lastRunAt: null, dayRuns: 0 };
  const [sql, unknown] = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [cleanup, other] });
  assertEquals([sql?.state, sql?.dayReached], ['ok', null]);
  assertEquals([unknown?.what, unknown?.when], ['Not described yet', 'pg_cron "* * * * *" (UTC)']);
  assertEquals(unknown?.state, 'not_run');
});

Deno.test('services › idle with no calls, recovered when it worked after failing, else failing', () => {
  const row: OpsStatusRow = {
    ...EMPTY_OPS_STATUS,
    providers: [
      {
        provider: 'sarvam',
        calls: 18,
        failed: 1,
        lastOkAt: '2026-11-23T10:00:00Z',
        lastFailedAt: '2026-11-22T10:00:00Z',
      },
    ],
    voice: {
      calls: 14,
      failed: 2,
      lastOkAt: '2026-11-20T10:00:00Z',
      lastFailedAt: '2026-11-21T10:00:00Z',
    },
  };
  const states = Object.fromEntries(servicesOf(row).map((one) => [one.name, one.state]));
  assertEquals(states, {
    'Supabase database': 'unknown',
    'Sarvam LLM (sarvam-105b)': 'recovered',
    Gemini: 'idle',
    'Sarvam voice agents': 'failing',
    'Meta WhatsApp': 'idle',
  });
});

Deno.test('services › WhatsApp failures are the larger of failed replies and logged send failures', () => {
  const row: OpsStatusRow = {
    ...EMPTY_OPS_STATUS,
    whatsapp: {
      repliesSent: 20,
      repliesFailed: 0,
      lastOkAt: '2026-11-21T10:00:00Z',
      sendFailures: 1,
      lastFailedAt: '2026-11-22T10:00:00Z',
    },
  };
  const whatsapp = servicesOf(row).find((one) => one.name === 'Meta WhatsApp');
  const later = { ...row, whatsapp: { ...row.whatsapp, lastOkAt: '2026-11-23T10:00:00Z' } };
  const recovered = servicesOf(later).find((one) => one.name === 'Meta WhatsApp');
  assertEquals(recovered?.state, 'recovered');
  assertEquals([whatsapp?.calls, whatsapp?.failed, whatsapp?.state], [20, 1, 'failing']);
});

Deno.test('targets › every target says how it is worked out; no data is neither met nor missed', () => {
  const status = buildStatus(input(EMPTY_OPS_STATUS));
  assertEquals(status.targets.map((one) => one.id), [
    'uptime',
    'requests',
    'jobs',
    'queue',
    'spend',
  ]);
  assertEquals(status.targets.every((one) => one.how.length > 20), true);
  const met = Object.fromEntries(status.targets.map((one) => [one.id, one.met]));
  assertEquals(met, {
    uptime: null,
    requests: null,
    jobs: null,
    queue: true,
    spend: true,
  });
});

Deno.test('targets › requests against the goal; agent targets are not on Ops (2026-11-23)', () => {
  const status = buildStatus({
    ...input(EMPTY_OPS_STATUS),
    summary: { ...EMPTY_OPS_SUMMARY, week: { requests: 1000, failed: 5 } },
  });
  const byId = Object.fromEntries(status.targets.map((one) => [one.id, [one.now, one.met]]));
  assertEquals(byId['requests'], ['99.50% (995 of 1000)', true]);
  assertEquals(byId['whatsapp'], undefined);
  assertEquals(byId['tools'], undefined);
});

Deno.test('jobs › more sweeps than pg_cron ran: the rest were started by our own code', () => {
  const [job] = jobsOf({ ...EMPTY_OPS_STATUS, jobs: [SWEEP], jobRequests: [reached(1447)] });
  assertEquals(job?.state, 'ok');
  assertEquals(
    job?.note,
    'pg_cron ran it 1440 times; the worker got 1447 (the rest were started by our own code).',
  );
});

Deno.test('targets › a job that has not run yet is not counted as on time', () => {
  const probe: CronJob = { ...SWEEP, name: 'health-probe', lastRunAt: null, dayRuns: 0 };
  const status = buildStatus(input({
    ...EMPTY_OPS_STATUS,
    jobs: [SWEEP, probe],
    jobRequests: [reached(1440)],
  }));
  const jobs = status.targets.find((one) => one.id === 'jobs');
  assertEquals([jobs?.now, jobs?.met], ['1 of 1 on time, 1 not run yet or off', true]);
});
