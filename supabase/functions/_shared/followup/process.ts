// supabase/functions/_shared/followup/process.ts
// The follow-up worker's job for one call (SPEC §8, M5 Decisions 4, 5, 9):
//   claim (compare-and-set) → transcript (wait and retry while Sarvam lags, up to 10 minutes)
//   → facts + promise check → rules, agent if unclear → note
//   → commit: one followup_runs row per call (a second worker stops here)
//   → note, follow-up row, score, WhatsApp summary to the owner (+ claim buttons) → done.
// Steps after the commit are each logged on failure but never undo it, so a summary is sent at
// most once. Logs carry ids, outcomes and error codes only.
import type { BookRepository } from '../db/book-repository.ts';
import { type FollowupCall, staleBefore } from '../db/followup-repository.ts';
import type { JsonLlm } from '../llm/json-llm.ts';
import type { Logger } from '../log.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { TranscriptClient } from '../sarvam-analytics.ts';
import { describeFailure } from '../tools/registry.ts';
import type { SenderConfig } from '../whatsapp/sender.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';
import { finishAfterCommit } from './after-commit.ts';
import { decideFollowup, runRecord } from './decide.ts';
import { type GatherDeps, gatherFacts } from './gather.ts';
import { writeNote } from './note.ts';
import { resolveTranscript, type TranscriptStep } from './transcript-step.ts';

/** The worker asks again this long after a "not ready" transcript or an error. */
export const RETRY_DELAY_MS = 30_000;
/** Due a little before the delayed retry arrives, so the retry always finds it due. */
const RETRY_DUE_MS = RETRY_DELAY_MS / 2;
/** ~10 minutes of transcript retries plus room for errors; then the call is marked failed. */
export const MAX_FOLLOWUP_ATTEMPTS = 30;
export const SWEEP_LIMIT = 5;

export interface FollowupDeps extends GatherDeps {
  readonly book: BookRepository;
  readonly llm: JsonLlm;
  readonly transcripts: TranscriptClient;
  readonly whatsapp: WhatsAppClient;
  /** The owner's number (a function secret) and the key for its stored hash. */
  readonly owner: SenderConfig;
  readonly log: Logger;
  /** Asks the worker to run this call again after RETRY_DELAY_MS. */
  readonly requeue: (callId: string) => void;
  /** Dry-run fix 8: the signed dashboard link to one call's page, or null when the dashboard is
   * not set up (DASHBOARD_URL / DASHBOARD_LINK_SECRET). */
  readonly callLink: (callId: string) => Promise<string | null>;
}

/** The owner bot's default language when the owner row cannot be read. */
const FALLBACK_LANGUAGE: Language = 'en';

/** The language the owner reads, for the LLM's owner-facing lines (fix 7). */
async function ownerLanguage(deps: FollowupDeps): Promise<Language> {
  const owner = await deps.book.getOwner().catch(() => null);
  return owner?.language ?? FALLBACK_LANGUAGE;
}

export type FollowupOutcome = 'done' | 'waiting' | 'skipped' | 'duplicate' | 'failed' | 'not_found';

function isClaimable(call: FollowupCall, now: Date): boolean {
  if (call.followupStatus === 'pending') {
    return call.followupNextAt === null || Date.parse(call.followupNextAt) <= now.getTime();
  }
  const claimedAt = Date.parse(call.followupClaimedAt ?? call.queuedAt);
  return call.followupStatus === 'running' && claimedAt < staleBefore(now).getTime();
}

async function retryLater(callId: string, deps: FollowupDeps): Promise<void> {
  await deps.followups.releaseFollowup(callId, new Date(deps.clock().getTime() + RETRY_DUE_MS));
  deps.requeue(callId);
}

async function commit(
  call: FollowupCall,
  transcript: TranscriptStep,
  deps: FollowupDeps,
): Promise<FollowupOutcome> {
  const gathered = await gatherFacts(call, transcript, deps);
  if (!gathered) {
    await deps.followups.failFollowup(call.callId);
    return 'not_found';
  }
  const language = await ownerLanguage(deps);
  const [decision, note] = await Promise.all([
    decideFollowup(gathered.facts, deps.llm, language),
    writeNote(deps.llm, gathered.facts, language),
  ]);
  const context = {
    facts: gathered.facts,
    decision,
    noteSource: note.source,
    transcript: transcript.kind,
  };
  const foundInteractionId = transcript.kind === 'none' ? null : transcript.foundInteractionId;
  const turns = transcript.kind === 'ready' ? transcript.turns : null;
  if (!(await deps.followups.insertFollowupRun(runRecord(context)))) {
    await deps.followups.finishFollowup(call.callId, {
      transcript: turns,
      summary: null,
      interactionId: foundInteractionId,
    });
    return 'duplicate';
  }
  const committed = { gathered, context, note: note.note, said: note.said, language };
  const summary = await finishAfterCommit(committed, deps);
  await deps.followups.finishFollowup(call.callId, {
    transcript: turns,
    summary,
    interactionId: foundInteractionId,
  });
  return 'done';
}

async function runClaimed(call: FollowupCall, deps: FollowupDeps): Promise<FollowupOutcome> {
  const transcript = await resolveTranscript(call, deps.transcripts, deps.clock());
  if (transcript.kind === 'wait') {
    await retryLater(call.callId, deps);
    return 'waiting';
  }
  return await commit(call, transcript, deps);
}

export async function processFollowup(
  callId: string,
  deps: FollowupDeps,
): Promise<FollowupOutcome> {
  const call = await deps.followups.getFollowupCall(callId);
  if (!call) return 'not_found';
  const now = deps.clock();
  if (!isClaimable(call, now)) return 'skipped';
  if (call.followupAttempts >= MAX_FOLLOWUP_ATTEMPTS) {
    await deps.followups.failFollowup(callId);
    deps.log('error', 'followup_gave_up', { callId, attempts: call.followupAttempts });
    return 'failed';
  }
  if (!(await deps.followups.claimFollowup(call, now))) return 'skipped';
  try {
    const outcome = await runClaimed(call, deps);
    deps.log('info', 'followup_run', { callId, outcome, attempt: call.followupAttempts + 1 });
    return outcome;
  } catch (error) {
    deps.log('error', 'followup_failed', { callId, error: describeFailure(error) });
    await retryLater(callId, deps);
    return 'failed';
  }
}

/** Runs every due follow-up, one after another (for the 5b cron sweep or a manual run). */
export async function sweepFollowups(deps: FollowupDeps): Promise<readonly FollowupOutcome[]> {
  const ids = await deps.followups.listDueFollowups(deps.clock(), SWEEP_LIMIT);
  const outcomes: FollowupOutcome[] = [];
  for (const id of ids) outcomes.push(await processFollowup(id, deps));
  return outcomes;
}
