// supabase/functions/_shared/followup/transcript-step.ts
// Getting the transcript for a follow-up (M5 Decision 5 (a)): simulated calls already have one;
// unanswered calls need none; a live call's transcript is fetched from Sarvam and, while it lags,
// the worker waits and tries again for up to 10 minutes after the call ended. After that the
// summary goes out from tool events alone, marked "transcript not available".
import type { FollowupCall } from '../db/followup-repository.ts';
import type { TranscriptClient, Turn } from '../sarvam-analytics.ts';

export const TRANSCRIPT_WAIT_MS = 10 * 60 * 1000;
/** How far around the call the interaction lookup searches (clocks differ a little). */
export const LOOKUP_MARGIN_MS = 2 * 60 * 1000;

export type TranscriptStep =
  | {
    readonly kind: 'ready';
    readonly turns: readonly Turn[];
    /** Found by the worker; null when it was already on the call. */
    readonly foundInteractionId: string | null;
  }
  | { readonly kind: 'none' }
  | { readonly kind: 'missing'; readonly foundInteractionId: string | null }
  | { readonly kind: 'wait'; readonly foundInteractionId: string | null };

function endedAt(call: FollowupCall): number {
  return Date.parse(call.endedAt ?? call.queuedAt);
}

async function interactionIdOf(
  call: FollowupCall,
  client: TranscriptClient,
  now: Date,
): Promise<{ id: string | null; found: boolean }> {
  if (call.interactionId !== null) return { id: call.interactionId, found: false };
  const from = new Date(Date.parse(call.acceptedAt ?? call.queuedAt) - LOOKUP_MARGIN_MS);
  const to = new Date(Math.min(endedAt(call) + LOOKUP_MARGIN_MS, now.getTime()));
  const id = await client.findInteractionId(call.callId, { from, to });
  return { id, found: id !== null };
}

export async function resolveTranscript(
  call: FollowupCall,
  client: TranscriptClient,
  now: Date,
): Promise<TranscriptStep> {
  if (call.mode === 'simulated') {
    return call.transcript
      ? { kind: 'ready', turns: call.transcript, foundInteractionId: null }
      : { kind: 'missing', foundInteractionId: null };
  }
  if (call.status !== 'completed') return { kind: 'none' };
  const interaction = await interactionIdOf(call, client, now);
  const foundInteractionId = interaction.found ? interaction.id : null;
  if (interaction.id !== null) {
    const result = await client.fetchTranscript(interaction.id);
    if (result.kind === 'ready') return { kind: 'ready', turns: result.turns, foundInteractionId };
  }
  const waitedEnough = now.getTime() - endedAt(call) >= TRANSCRIPT_WAIT_MS;
  return { kind: waitedEnough ? 'missing' : 'wait', foundInteractionId };
}
