// web/src/lib/replyTimer.ts
// The agent's reply time as the caller hears it (live evals, 2026-11-20; mic fallback 2026-11-23):
// from the person's speech ending to the agent's voice starting on this page, one per reply.
// The end of speech comes from Sarvam's "speech ended" event when one arrived for that turn, and
// otherwise from the microphone level: the last loud moment before the agent speaks. Every live
// call from 20 to 23 Nov timed 0 replies: no "speech ended" ever arrived, and the first mic
// fallback (b6f8661) switched itself off once any Sarvam speech event had arrived, so it never
// ran either. The SDK reports the mic level only while the agent is not speaking, and the mic has
// echo cancellation on, so the agent's own voice does not count as the person speaking.
// The page also counts which signals it got (signals()), saved with the call, so a call that
// times nothing shows why.
import { HOLD_MS } from './micLevel.ts';

/** Sarvam's speech events for the person on the page (SDK ServerMsgType values). */
export const USER_SPEECH_START = 'server.event.user_speech_start';
export const USER_SPEECH_END = 'server.event.user_speech_end';
export const USER_INTERRUPT = 'server.event.user_interrupt';

/** At most this many reply times are kept for one call. */
export const MAX_REPLY_TIMES = 100;
/** Mic level (0..1 RMS, about -36 dB) that counts as the person speaking, for timing only: lower
 * than the speaking arrow's 0.03 so quiet last words still count; MIN_SPEECH_MS keeps out blips. */
export const REPLY_SPEECH_RMS = 0.015;
/** A sound shorter than this is a click or a cough, not something the agent replies to. */
export const MIN_SPEECH_MS = 250;
/** A longer silence means the agent spoke up on its own after a pause, not a reply. */
export const MAX_REPLY_WAIT_MS = 15_000;

/** How many of each speech signal the page got in one call. */
export interface SpeechSignals {
  readonly speechStart: number;
  readonly speechEnd: number;
  readonly interrupt: number;
  /** Stretches of the person's speech heard on the mic. */
  readonly micSpeech: number;
  /** The loudest mic level heard (0..1 RMS, 3 decimals); 0 means the mic level never arrived. */
  readonly micPeak: number;
}

export interface ReplyTimer {
  readonly onServerEvent: (type: string) => void;
  readonly onInputLevel: (rms: number) => void;
  readonly onState: (state: string) => void;
  readonly times: () => readonly number[];
  readonly signals: () => SpeechSignals;
}

const SIGNAL_OF: Readonly<Record<string, 'speechStart' | 'speechEnd' | 'interrupt'>> = {
  [USER_SPEECH_START]: 'speechStart',
  [USER_SPEECH_END]: 'speechEnd',
  [USER_INTERRUPT]: 'interrupt',
};

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
  const counts = { speechStart: 0, speechEnd: 0, interrupt: 0, micSpeech: 0 };
  let micPeak = 0;
  let speechEndedAt: number | null = null;

  return {
    onServerEvent(type) {
      const signal = SIGNAL_OF[type];
      if (!signal) return;
      counts[signal] += 1;
      speechEndedAt = signal === 'speechEnd' ? now() : null;
    },
    onInputLevel(rms) {
      micPeak = Math.max(micPeak, rms);
      if (rms < REPLY_SPEECH_RMS) return;
      const at = now();
      // A gap longer than the speaking light's hold starts a new stretch of speech.
      if (heard.lastLoudAt === null || at - heard.lastLoudAt > HOLD_MS) {
        heard.startedAt = at;
        counts.micSpeech += 1;
      }
      heard.lastLoudAt = at;
    },
    onState(state) {
      if (state !== 'speaking') return;
      const at = now();
      const endedAt = speechEndedAt ?? micSpeechEnd(heard, at);
      if (endedAt !== null && times.length < MAX_REPLY_TIMES) {
        times.push(Math.max(0, Math.round(at - endedAt)));
      }
      speechEndedAt = null;
      heard.startedAt = null;
      heard.lastLoudAt = null;
    },
    times: () => [...times],
    signals: () => ({ ...counts, micPeak: Math.round(micPeak * 1000) / 1000 }),
  };
}
