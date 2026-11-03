// supabase/functions/_shared/followup/kick.ts
// Wakes the follow-up worker for one call: calls-api does it the moment a call ends, and the
// worker does it to itself to retry while Sarvam's transcript lags. The request carries
// WORKER_SECRET as a bearer token and runs in the background (the caller never waits for it). A
// failed kick is logged; the call stays "pending", so the 5b cron sweep (or a manual
// POST /followup-worker/sweep) still picks it up.
import type { Logger } from '../log.ts';

const KICK_TIMEOUT_MS = 10_000;

export interface KickerConfig {
  /** e.g. https://<ref>.supabase.co/functions/v1/followup-worker */
  readonly workerUrl: string;
  readonly secret: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
  /** Keeps the function alive until the task finishes (EdgeRuntime.waitUntil). */
  readonly defer: (task: Promise<unknown>) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type FollowupKicker = (callId: string, delayMs?: number) => void;

export function followupWorkerUrl(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/followup-worker`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Posts one worker path with the secret; failures are logged with the path and status only. */
function createPoster(config: KickerConfig): (path: string, delayMs: number) => Promise<void> {
  const sleep = config.sleep ?? wait;
  return async function post(path: string, delayMs: number): Promise<void> {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const response = await config.fetchImpl(`${config.workerUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.secret}` },
        signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
      });
      if (!response.ok) {
        config.log('warn', 'followup_kick_failed', { path, status: response.status });
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      config.log('warn', 'followup_kick_failed', { path, error: name });
    }
  };
}

export function createFollowupKicker(config: KickerConfig): FollowupKicker {
  const post = createPoster(config);
  return function kickFollowup(callId, delayMs = 0): void {
    config.defer(post(`/calls/${callId}`, delayMs));
  };
}

/** Worker paths the reminder flow wakes (M5 5b). */
export const SIMULATION_NEXT_PATH = '/simulations/next';
export const SWEEP_PATH = '/sweep';

/** Wakes the worker on a fixed path, `times` times (each wake is its own background run). */
export type JobKicker = (path: string, times?: number) => void;

export function createJobKicker(config: KickerConfig): JobKicker {
  const post = createPoster(config);
  return function kickJob(path, times = 1): void {
    for (let i = 0; i < times; i += 1) config.defer(post(path, 0));
  };
}
