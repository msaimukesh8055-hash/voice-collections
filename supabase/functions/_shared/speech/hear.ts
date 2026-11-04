// supabase/functions/_shared/speech/hear.ts
// One owner voice note → what was said (M6, SPEC §6.7): daily cap → download from Meta (1 MB
// max) → length from the file (30 s max, Ogg/Opus only) → Saaras. Every "no" is decided before
// Saaras is called, so a refused note costs nothing (M6 Decision 10). Nothing is stored.
import { oggOpusSeconds } from '../audio/ogg.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { Download } from '../whatsapp/media.ts';
import type { AudioFile, Transcription } from './stt.ts';

export const MAX_VOICE_SECONDS = 30;
/** Voice notes listened to per India day (M6 Decision 10). */
export const DAILY_VOICE_CAP = 50;

export type Hearing =
  | { readonly kind: 'heard'; readonly text: string; readonly language: Language }
  /** Why a voice note was not listened to; each has its own reply line. */
  | { readonly kind: 'too_long' | 'too_big' | 'not_voice' | 'empty' | 'failed' | 'cap' };

export type HearingProblem = Exclude<Hearing, { kind: 'heard' }>['kind'];

export interface HearDeps {
  readonly download: (mediaId: string) => Promise<Download>;
  readonly transcribe: (audio: AudioFile) => Promise<Transcription>;
  /** Voice notes received today, this one included (counted up to the cap + 1). */
  readonly countToday: () => Promise<number>;
}

export async function hear(mediaId: string, deps: HearDeps): Promise<Hearing> {
  if (await deps.countToday() > DAILY_VOICE_CAP) return { kind: 'cap' };
  const file = await deps.download(mediaId);
  if (file.kind !== 'ok') return { kind: file.kind };
  const seconds = oggOpusSeconds(file.bytes);
  if (seconds === null) return { kind: 'not_voice' };
  if (seconds > MAX_VOICE_SECONDS) return { kind: 'too_long' };
  return await deps.transcribe({ bytes: file.bytes, mimeType: file.mimeType });
}
