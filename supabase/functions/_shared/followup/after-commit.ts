// supabase/functions/_shared/followup/after-commit.ts
// What happens once a follow-up run is committed: the note for Asha's next call, the follow-up
// row, the recalculated score (SPEC §9) and the owner's WhatsApp summary. Each step is attempted
// on its own and logged if it fails, so one failure (say, Meta refusing a message outside the
// 24-hour window) never blocks the others or repeats the run.
import { istDate } from '../clock.ts';
import { computeScore, type Score } from '../ledger/score.ts';
import type { Logger } from '../log.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { describeFailure } from '../tools/registry.ts';
import { replyText } from '../whatsapp/replies.ts';
import { identifySender } from '../whatsapp/sender.ts';
import { followupRowFor, type RunContext } from './decide.ts';
import type { Gathered } from './gather.ts';
import type { FollowupDeps } from './process.ts';
import { buildSummary, type SaidSummary } from './summary.ts';

export interface Committed {
  readonly gathered: Gathered;
  readonly context: RunContext;
  readonly note: string;
  /** The LLM's summary lines for the owner (null when the note was written in code). */
  readonly said: SaidSummary | null;
  /** The owner's language, read once before the LLM wrote its owner-facing lines. */
  readonly language: Language;
}

async function attempt<T>(
  step: string,
  run: () => Promise<T>,
  ctx: { readonly log: Logger; readonly callId: string },
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    ctx.log('error', 'followup_step_failed', {
      callId: ctx.callId,
      step,
      error: describeFailure(error),
    });
    return null;
  }
}

async function saveScore(committed: Committed, deps: FollowupDeps): Promise<Score> {
  const { gathered } = committed;
  const score = computeScore({
    entries: gathered.entries,
    promises: gathered.promises,
    callStatuses: gathered.callStatuses,
    today: gathered.today,
  });
  await deps.followups.saveScore(gathered.facts.shopkeeperId, score, deps.clock());
  return score;
}

async function sendSummary(
  committed: Committed,
  score: Score | null,
  deps: FollowupDeps,
): Promise<string> {
  const { facts } = committed.gathered;
  const transcriptLink = await deps.callLink(facts.callId).catch((error: unknown) => {
    deps.log('warn', 'call_link_failed', { callId: facts.callId, error: describeFailure(error) });
    return null;
  });
  const reply = buildSummary({
    facts,
    step: committed.context.decision.step,
    score,
    language: committed.language,
    said: committed.said,
    transcriptLink,
  });
  const [messageId, sender] = await Promise.all([
    deps.whatsapp.send(deps.owner.ownerNumber, reply),
    identifySender(deps.owner.ownerNumber, deps.owner),
  ]);
  await deps.book.recordOutbound({
    waMessageId: messageId,
    senderHash: sender.senderHash,
    msgType: reply.kind,
    istDay: istDate(deps.clock()),
  });
  return replyText([reply]);
}

/** Runs the after-commit steps; returns the summary text (null if it could not be built). */
export async function finishAfterCommit(
  committed: Committed,
  deps: FollowupDeps,
): Promise<string | null> {
  const { facts } = committed.gathered;
  const ctx = { log: deps.log, callId: facts.callId };
  const row = followupRowFor(committed.context);
  await Promise.all([
    attempt('note', () =>
      deps.followups.insertNote({
        callId: facts.callId,
        shopkeeperId: facts.shopkeeperId,
        note: committed.note,
      }), ctx),
    row ? attempt('followup_row', () => deps.followups.insertFollowup(row), ctx) : null,
  ]);
  const score = await attempt('score', () => saveScore(committed, deps), ctx);
  return await attempt('summary', () => sendSummary(committed, score, deps), ctx);
}
