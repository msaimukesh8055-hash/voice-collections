// web/src/lib/replyTimer.ts
// The agent's reply time as the caller hears it (live evals, 2026-11-20; mic fallback 2026-11-23):
// from the person's speech ending to the agent's voice starting on this page, one per reply.
// The end of speech comes from Sarvam's "speech ended" event when Sarvam sends one. Sarvam sent
// none on any live call (every call from 20 to 23 Nov reported 0 timed replies), so it otherwise
// comes from the microphone level: the last loud moment before the agent speaks. The SDK reports
// the mic level only while the agent is not speaking, and the mic has echo cancellation on, so
// the agent's own voice does not count as the person speaking.
import { HOLD_MS, SPEAKING_RMS } from './micLevel.ts';

/** Sarvam's speech events for the person on the page (SDK ServerMsgType values). */
export const USER_SPEECH_START = 'server.event.user_speech_start';
export const USER_SPEECH_END = 'server.event.user_speech_end';
export const USER_INTERRUPT = 'server.event.user_interrupt';

/** At most this many reply times are kept for one call. */
export const MAX_REPLY_TIMES = 100;
/** A sound shorter than this is a click or a cough, not something the agent replies to. */
export const MIN_SPEECH_MS = 250;
/** A longer silence means the agent spoke up on its own after a pause, not a reply. */
export const MAX_REPLY_WAIT_MS = 15_000;

export interface ReplyTimer {
  readonly onServerEvent: (type: string) => void;
  readonly onInputLevel: (rms: number) => void;
  readonly onState: (state: string) => void;
  readonly times: () => readonly number[];
}

/** The person's latest stretch of speech, from the mic level. */
interface Heard {
  startedAt: number | null;
  lastLoudAt: number | null;
}

/** When the person stopped speaking, by the mic, or null if nothing counts as a reply. */
function micSpeechEnd(heard: Heard, at: number): number | null {
  const { startedAt, lastLoudAt } = heard;
  if (startedAt === null || lastLoudAt === null) return null;
  if (lastLoudAt - startedAt < MIN_SPEECH_MS) return null;
  return at - lastLoudAt > MAX_REPLY_WAIT_MS ? null : lastLoudAt;
}

export function createReplyTimer(now: () => number): ReplyTimer {
  const times: number[] = [];
  const heard: Heard = { startedAt: null, lastLoudAt: null };
  let speechEventsSeen = false;
  let speechEndedAt: number | null = null;

  return {
    onServerEvent(type) {
      if (type === USER_SPEECH_END) speechEndedAt = now();
      else if (type === USER_SPEECH_START || type === USER_INTERRUPT) speechEndedAt = null;
      else return;
      speechEventsSeen = true;
    },
    onInputLevel(rms) {
      if (rms < SPEAKING_RMS) return;
      const at = now();
      // A gap longer than the speaking light's hold starts a new stretch of speech.
      if (heard.lastLoudAt === null || at - heard.lastLoudAt > HOLD_MS) heard.startedAt = at;
      heard.lastLoudAt = at;
    },
    onState(state) {
      if (state !== 'speaking') return;
      const at = now();
      const endedAt = speechEventsSeen ? speechEndedAt : micSpeechEnd(heard, at);
      if (endedAt !== null && times.length < MAX_REPLY_TIMES) {
        times.push(Math.max(0, Math.round(at - endedAt)));
      }
      speechEndedAt = null;
      heard.startedAt = null;
      heard.lastLoudAt = null;
    },
    times: () => [...times],
  };
}
