// supabase/functions/_shared/speech/stt.ts
// Sarvam Saaras speech-to-text for the owner's voice notes (M6, SPEC §6.7). WhatsApp's OGG/Opus
// file goes as it is (Saaras accepts it; no conversion). The language is detected by Saaras and
// mapped to te / hi / en for the reply. Model and mode are one setting each, picked by the voice
// spike (M6 Decision 2). The audio and the transcript are never logged or stored.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
export const STT_TIMEOUT_MS = 15_000;

/**
 * M6 Decision 2, option (b), chosen by Saim after the voice spike: translit (all English letters)
 * got every shopkeeper name and amount right; codemix wrote names in Telugu/Hindi script and
 * misheard "Farooq".
 */
export const STT_SETTINGS = { model: 'saaras:v3', mode: 'translit' } as const;

export interface SttConfig {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
  /** Overrides for the spike (v4 has no mode; keyterms are v4 only). */
  readonly model?: string;
  readonly mode?: string | null;
  /** saaras:v4 only: up to 50 words to listen for, e.g. shopkeeper names. */
  readonly keyterms?: readonly string[];
}

export interface AudioFile {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

export type Transcription =
  | { readonly kind: 'heard'; readonly text: string; readonly language: Language }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed' };

export type Transcriber = (audio: AudioFile) => Promise<Transcription>;

const SttReply = z.object({
  transcript: z.string(),
  language_code: z.string().nullable().optional(),
});

const MAX_KEYTERMS = 50;

/** "te-IN" → te, "hi-IN" → hi; anything else (English, unknown, other Indian languages) → en. */
export function languageOf(code: string | null | undefined): Language {
  const base = (code ?? '').toLowerCase().split('-')[0];
  return base === 'te' || base === 'hi' ? base : 'en';
}

function formOf(config: SttConfig, audio: AudioFile): FormData {
  const form = new FormData();
  const type = audio.mimeType.split(';')[0]?.trim() || 'audio/ogg';
  form.append('file', new Blob([audio.bytes], { type }), 'voice.ogg');
  form.append('model', config.model ?? STT_SETTINGS.model);
  const mode = config.mode === undefined ? STT_SETTINGS.mode : config.mode;
  if (mode !== null) form.append('mode', mode);
  form.append('language_code', 'unknown');
  if (config.keyterms && config.keyterms.length > 0) {
    form.append('keyterms', JSON.stringify(config.keyterms.slice(0, MAX_KEYTERMS)));
  }
  return form;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export function createTranscriber(config: SttConfig): Transcriber {
  return async function transcribe(audio: AudioFile): Promise<Transcription> {
    try {
      const response = await config.fetchImpl(SARVAM_STT_URL, {
        method: 'POST',
        headers: { 'api-subscription-key': config.apiKey },
        body: formOf(config, audio),
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      if (!response.ok) {
        config.log('warn', 'stt_failed', { error: 'http', status: response.status });
        return { kind: 'failed' };
      }
      const reply = SttReply.parse(await response.json());
      const text = reply.transcript.trim();
      if (text === '') return { kind: 'empty' };
      return { kind: 'heard', text, language: languageOf(reply.language_code) };
    } catch (error) {
      config.log('warn', 'stt_failed', { error: errorName(error), status: null });
      return { kind: 'failed' };
    }
  };
}
