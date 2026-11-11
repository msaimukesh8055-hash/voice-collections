// supabase/functions/followup-worker/handler.test.ts
// Worker auth (100%): wrong or missing secret → 401 and nothing runs; the right one → 202 and the
// job runs in the background.
import { assertEquals } from '@std/assert';
import type { LogFields } from '../_shared/log.ts';
import { handleWorkerRequest, type WorkerDeps } from './handler.ts';

const SECRET = 'w'.repeat(40);
const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const BASE = 'https://ref.supabase.co/functions/v1/followup-worker';

interface WorkerSetup {
  readonly deps: WorkerDeps;
  readonly tasks: Promise<unknown>[];
  readonly processed: string[];
  readonly logs: { event: string; fields: LogFields }[];
  readonly sweeps: () => number;
  readonly jobs: string[];
}

function setup(overrides: Partial<WorkerDeps> = {}): WorkerSetup {
  const tasks: Promise<unknown>[] = [];
  const processed: string[] = [];
  let sweeps = 0;
  const logs: { event: string; fields: LogFields }[] = [];
  const jobs: string[] = [];
  const deps: WorkerDeps = {
    secret: SECRET,
    defer: (task) => tasks.push(task),
    process: (callId) => {
      processed.push(callId);
      return Promise.resolve('done');
    },
    sweep: () => {
      sweeps += 1;
      return Promise.resolve(['done']);
    },
    nextSimulation: () => {
      jobs.push('nextSimulation');
      return Promise.resolve('idle');
    },
    dailyAlert: () => {
      jobs.push('dailyAlert');
      return Promise.resolve('sent_full');
    },
    promiseCheck: () => {
      jobs.push('promiseCheck');
      return Promise.resolve(0);
    },
    opsWatch: () => {
      jobs.push('opsWatch');
      return Promise.resolve();
    },
    ownerSend: (actionId) => {
      jobs.push(`ownerSend:${actionId}`);
      return Promise.resolve('sent');
    },
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
    ...overrides,
  };
  return { deps, tasks, processed, logs, sweeps: () => sweeps, jobs };
}

function post(path: string, secret: string | null = SECRET, method = 'POST'): Request {
  const headers: Record<string, string> = secret === null
    ? {}
    : { authorization: `Bearer ${secret}` };
  return new Request(`${BASE}${path}`, { method, headers });
}

Deno.test('worker › wrong or missing secret → 401, nothing runs, secret never logged', async () => {
  for (const secret of [null, 'wrong', `${SECRET}x`]) {
    const { deps, tasks, processed, logs } = setup();
    const response = await handleWorkerRequest(post(`/calls/${CALL_ID}`, secret), deps);
    assertEquals(response.status, 401);
    assertEquals([tasks.length, processed.length], [0, 0]);
    assertEquals(JSON.stringify(logs).includes(SECRET), false);
  }
});

Deno.test('worker › a call follow-up is accepted and runs in the background', async () => {
  const { deps, tasks, processed } = setup();
  const response = await handleWorkerRequest(post(`/calls/${CALL_ID}`), deps);
  assertEquals(response.status, 202);
  assertEquals(await response.json(), { accepted: true });
  await Promise.all(tasks);
  assertEquals(processed, [CALL_ID]);
});

Deno.test('worker › sweep is accepted and runs in the background', async () => {
  const { deps, tasks, sweeps } = setup();
  assertEquals((await handleWorkerRequest(post('/sweep'), deps)).status, 202);
  await Promise.all(tasks);
  assertEquals(sweeps(), 1);
});

Deno.test('worker › bad call id or unknown path → 404; GET → 405', async () => {
  const { deps, tasks } = setup();
  assertEquals((await handleWorkerRequest(post('/calls/not-a-uuid'), deps)).status, 404);
  assertEquals((await handleWorkerRequest(post('/other'), deps)).status, 404);
  assertEquals((await handleWorkerRequest(post('/sweep', SECRET, 'GET'), deps)).status, 405);
  assertEquals(tasks.length, 0);
});

Deno.test('worker › a background job that throws is logged by code, not crashed', async () => {
  const { deps, tasks, logs } = setup({ process: () => Promise.reject(new TypeError('down')) });
  assertEquals((await handleWorkerRequest(post(`/calls/${CALL_ID}`), deps)).status, 202);
  await Promise.all(tasks);
  assertEquals(logs.at(-1), {
    event: 'worker_job_failed',
    fields: { job: 'followup', error: 'TypeError' },
  });
});

Deno.test('worker › paths without the function prefix still route', async () => {
  const { deps } = setup();
  const request = new Request(`https://local.test/calls/${CALL_ID}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
  });
  assertEquals((await handleWorkerRequest(request, deps)).status, 202);
});

Deno.test('worker › an unexpected error becomes a safe 500', async () => {
  const { deps } = setup({
    defer: () => {
      throw new Error('boom');
    },
  });
  assertEquals((await handleWorkerRequest(post('/sweep'), deps)).status, 500);
});

Deno.test('worker › cron and queue jobs run in the background with the secret only (M5 5b)', async () => {
  const paths = ['/simulations/next', '/daily-alert', '/promise-check'];
  const { deps, tasks, jobs } = setup();
  for (const path of paths) {
    assertEquals((await handleWorkerRequest(post(path, 'wrong'), deps)).status, 401);
  }
  assertEquals(jobs, []);
  for (const path of paths) {
    assertEquals((await handleWorkerRequest(post(path), deps)).status, 202);
  }
  await Promise.all(tasks);
  assertEquals(jobs, ['nextSimulation', 'dailyAlert', 'promiseCheck']);
});

Deno.test('worker › an unknown path is not found', async () => {
  const { deps, tasks } = setup();
  assertEquals((await handleWorkerRequest(post('/constructor'), deps)).status, 404);
  assertEquals(tasks.length, 0);
});

Deno.test('worker › /owner-send/<id> runs the send job once in the background (M8 B5)', async () => {
  const { deps, tasks, jobs } = setup();
  const response = await handleWorkerRequest(post(`/owner-send/${CALL_ID}`), deps);
  await Promise.all(tasks);
  assertEquals([response.status, jobs], [202, [`ownerSend:${CALL_ID}`]]);
});

Deno.test('worker › /owner-send needs the secret and a uuid', async () => {
  const noSecret = setup();
  const refused = await handleWorkerRequest(post(`/owner-send/${CALL_ID}`, 'wrong'), noSecret.deps);
  const badId = setup();
  const notFound = await handleWorkerRequest(post('/owner-send/not-a-uuid'), badId.deps);
  assertEquals([refused.status, notFound.status], [401, 404]);
  assertEquals([...noSecret.jobs, ...badId.jobs], []);
});

Deno.test('worker › POST /ops-watch starts the failure watch, only with the secret (M9)', async () => {
  const { deps, jobs, tasks } = setup();
  const url = 'https://ref.supabase.co/functions/v1/followup-worker/ops-watch';
  const refused = await handleWorkerRequest(new Request(url, { method: 'POST' }), deps);
  assertEquals([refused.status, jobs], [401, []]);
  const headers = { authorization: `Bearer ${SECRET}` };
  const response = await handleWorkerRequest(new Request(url, { method: 'POST', headers }), deps);
  await Promise.all(tasks);
  assertEquals([response.status, jobs], [202, ['opsWatch']]);
});
