// web/src/lib/micLevel.ts
// Ramesh's "speaking" light. The Sarvam SDK reports Asha's speaking state but not the caller's,
// so we derive it from the microphone level the SDK already measures (RMS, 0..1). A short hold
// keeps the light steady between words instead of flickering.
export const SPEAKING_RMS = 0.03;
export const HOLD_MS = 450;

export interface SpeechDetector {
  /** Feed one level reading; returns whether the caller counts as speaking now. */
  readonly update: (rms: number, atMs: number) => boolean;
  readonly reset: () => void;
}

export function createSpeechDetector(threshold = SPEAKING_RMS, holdMs = HOLD_MS): SpeechDetector {
  let lastLoudAt: number | null = null;
  return {
    update(rms, atMs) {
      if (rms >= threshold) lastLoudAt = atMs;
      return lastLoudAt !== null && atMs - lastLoudAt <= holdMs;
    },
    reset() {
      lastLoudAt = null;
    },
  };
}
