// supabase/functions/followup-worker/handler.ts
// The follow-up worker's door (M5, ADR-0016). Only callers holding WORKER_SECRET get in:
// calls-api when a call ends, the worker itself when it retries, and pg_cron in 5b. The secret
// is checked in constant time before anything else; then the work runs in the background and
// the caller gets 202 at once.
//   POST /followup-worker/calls/{call id}  follow up one call
//   POST /followup-worker/sweep            due follow-ups + start queued simulated calls (cron,
//                                          every minute; or by hand)
//   POST /followup-worker/simulations/next start the next queued simulated call, if a slot is free
//   POST /followup-worker/daily-alert      the owner's daily due alert (cron, 9:00 IST)
//   POST /followup-worker/promise-check    the daily promise check (cron)
//   POST /followup-worker/owner-send/{id}  M8 B5: send what the owner asked Munshi for (once)
import { z } from 'zod';
import { hasBearerSecret } from '../_shared/auth/bearer.ts';
import type { FollowupOutcome } from '../_shared/followup/process.ts';
import { errorResponse, jsonResponse, withErrorBoundary } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { describeFailure } from '../_shared/tools/registry.ts';

const FUNCTION_PREFIX = '/followup-worker';
const CALL_PATH = /^\/calls\/([^/]+)$/;
const OWNER_SEND_PATH = /^\/owner-send\/([^/]+)$/;
const ACCEPTED = 202;

export interface WorkerDeps {
  readonly secret: string;
  readonly defer: (task: Promise<unknown>) => void;
  readonly process: (callId: string) => Promise<FollowupOutcome>;
  readonly sweep: () => Promise<unknown>;
  readonly nextSimulation: () => Promise<unknown>;
  readonly dailyAlert: () => Promise<unknown>;
  readonly promiseCheck: () => Promise<unknown>;
  /** M8 B5: one voice_send action (reminders/owner-send.ts). */
  readonly ownerSend: (actionId: string) => Promise<unknown>;
  readonly log: Logger;
}

function routePath(req: Request): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(FUNCTION_PREFIX);
  return start === -1 ? pathname : pathname.slice(start + FUNCTION_PREFIX.length);
}

/** Background work has no caller to answer, so its errors are logged here (codes only). */
function inBackground(deps: WorkerDeps, job: string, task: () => Promise<unknown>): void {
  deps.defer(
    task().catch((error: unknown) => {
      deps.log('error', 'worker_job_failed', { job, error: describeFailure(error) });
    }),
  );
}

function accepted(): Response {
  return jsonResponse({ accepted: true }, ACCEPTED);
}

/** Fixed paths → the background job they start (typed lookup, no switch). */
const JOBS: Readonly<Record<string, 'sweep' | 'nextSimulation' | 'dailyAlert' | 'promiseCheck'>> = {
  '/sweep': 'sweep',
  '/simulations/next': 'nextSimulation',
  '/daily-alert': 'dailyAlert',
  '/promise-check': 'promiseCheck',
};

async function route(req: Request, deps: WorkerDeps): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');
  if (!(await hasBearerSecret(req, deps.secret))) {
    deps.log('warn', 'worker_request_unauthorised');
    return errorResponse('UNAUTHORIZED');
  }
  const path = routePath(req);
  const job = Object.hasOwn(JOBS, path) ? JOBS[path] : undefined;
  if (job) {
    inBackground(deps, job, deps[job]);
    return accepted();
  }
  const sendId = OWNER_SEND_PATH.exec(path)?.[1];
  if (sendId !== undefined) {
    const actionId = z.uuid().safeParse(sendId);
    if (!actionId.success) return errorResponse('NOT_FOUND');
    inBackground(deps, 'owner_send', () => deps.ownerSend(actionId.data));
    return accepted();
  }
  const callId = z.uuid().safeParse(CALL_PATH.exec(path)?.[1]);
  if (!callId.success) return errorResponse('NOT_FOUND');
  inBackground(deps, 'followup', () => deps.process(callId.data));
  return accepted();
}

export function handleWorkerRequest(req: Request, deps: WorkerDeps): Promise<Response> {
  return withErrorBoundary(() => route(req, deps), deps.log);
}
