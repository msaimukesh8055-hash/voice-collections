// supabase/functions/_shared/ops/watch.ts
// The failure alert (M9 Build A): every 5 minutes pg_cron wakes the worker, which looks at the
// last 15 minutes of error steps and the follow-up queue and sends one short WhatsApp message to
// the ops number. A problem is alerted once per 15-minute window (the database refuses a second
// claim), so a storm of the same error is one message, not fifty. The message holds function
// names, step names and error codes only.
import type { OpsError, OpsRepository } from '../db/ops-repository.ts';
import type { Logger } from '../log.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';
import { leadErrors } from './lead-errors.ts';

export const ALERT_WINDOW_MS = 15 * 60 * 1000;
/** A message lists the biggest problems; the ops page has the rest. */
export const MAX_ALERT_LINES = 5;
export const STUCK_KEY = 'followups_stuck';

export interface Problem {
  /** What makes two failures "the same problem": function, step and error code. */
  readonly key: string;
  readonly line: string;
  /** Requests hit in the window. */
  readonly count: number;
  readonly traceId: string | null;
}

export interface OpsWatchDeps {
  readonly ops: OpsRepository;
  readonly whatsapp: WhatsAppClient;
  /** Who gets the alert (OPS_ALERT_WHATSAPP_NUMBER, else the owner's number). */
  readonly alertNumber: string;
  /** A signed link to one trace on the ops page; null when no dashboard is set up. */
  readonly traceLink: (traceId: string) => Promise<string | null>;
  readonly clock: () => Date;
  readonly log: Logger;
}

export type OpsWatchOutcome =
  | { readonly alerted: false; readonly reason: 'nothing_wrong' | 'already_alerted' }
  | { readonly alerted: true; readonly problems: number; readonly delivered: boolean };

function keyOf(error: OpsError): string {
  return `${error.source}|${error.step}|${error.errorCode ?? '-'}`;
}

function lineOf(error: OpsError, count: number): string {
  const code = error.errorCode ? ` (${error.errorCode})` : '';
  const times = count > 1 ? ` ×${count}` : '';
  return `${error.source} · ${error.step}${code}${times}`;
}

/** Error steps → one problem per (function, step, code), biggest first. */
export function problemsOf(errors: readonly OpsError[]): readonly Problem[] {
  const byKey = Map.groupBy(leadErrors(errors), keyOf);
  return [...byKey.entries()]
    .map(([key, same]): Problem | null => {
      const first = same[0];
      if (!first) return null;
      return { key, line: lineOf(first, same.length), count: same.length, traceId: first.traceId };
    })
    .filter((problem) => problem !== null)
    .sort((a, b) => b.count - a.count);
}

function stuckProblem(stuck: number): readonly Problem[] {
  if (stuck === 0) return [];
  const noun = stuck === 1 ? 'follow-up' : 'follow-ups';
  const line = `${stuck} ${noun} stuck for over 10 minutes`;
  return [{ key: STUCK_KEY, line, count: stuck, traceId: null }];
}

/** The alert as the ops number reads it. Wording is Saim's (M9 Decision 7). */
export function alertText(problems: readonly Problem[], link: string | null): string {
  const lines = problems.map((problem) => `• ${problem.line}`);
  const tail = link ? ['', 'Open the trace:', link] : [];
  return [
    '⚠️ Easy Recovery AI: something failed',
    '',
    ...lines,
    '',
    'Seen in the last 15 minutes.',
    ...tail,
  ].join('\n');
}

async function claimFresh(
  deps: OpsWatchDeps,
  problems: readonly Problem[],
  now: Date,
): Promise<readonly Problem[]> {
  const window = Math.floor(now.getTime() / ALERT_WINDOW_MS);
  const claimed = await Promise.all(
    problems.map((problem) =>
      deps.ops.claimAlert({
        key: problem.key,
        window,
        count: problem.count,
        traceId: problem.traceId,
      })
    ),
  );
  return problems.filter((_problem, index) => claimed[index] === true);
}

export async function runOpsWatch(deps: OpsWatchDeps): Promise<OpsWatchOutcome> {
  const now = deps.clock();
  const since = new Date(now.getTime() - ALERT_WINDOW_MS);
  const [errors, summary] = await Promise.all([
    deps.ops.listErrorsSince(since.toISOString()),
    deps.ops.getSummary(),
  ]);
  const found = [...problemsOf(errors), ...stuckProblem(summary.followups.stuck)];
  if (found.length === 0) return { alerted: false, reason: 'nothing_wrong' };
  const fresh = await claimFresh(deps, found.slice(0, MAX_ALERT_LINES), now);
  if (fresh.length === 0) return { alerted: false, reason: 'already_alerted' };
  const traceId = fresh.find((problem) => problem.traceId !== null)?.traceId ?? null;
  const link = traceId ? await deps.traceLink(traceId) : null;
  const sent = await deps.whatsapp.send(deps.alertNumber, {
    kind: 'text',
    text: alertText(fresh, link),
  });
  const delivered = sent !== null;
  // A refused alert (WhatsApp's 24-hour rule) is a warning, not an error: an error here would
  // raise another alert about the alert.
  deps.log(delivered ? 'info' : 'warn', 'ops_alert', { problems: fresh.length, delivered });
  return { alerted: true, problems: fresh.length, delivered };
}

/** The alert's own send failures are warnings for the same reason. */
export function withoutErrors(log: Logger): Logger {
  return function logQuietly(level, event, fields): void {
    log(level === 'error' ? 'warn' : level, event, fields);
  };
}
