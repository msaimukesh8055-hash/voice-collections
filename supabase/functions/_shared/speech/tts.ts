// supabase/functions/_shared/speech/tts.ts
// Sarvam Bulbul text-to-speech for the bot's voice replies (M6 Decision 3, SPEC §6.7). MP3 out
// (Bulbul's Opus output errors on v3, so a WhatsApp "voice bubble" is not possible yet; MP3 plays
// as an audio message). Voice: Kavitha, the same voice as Asha, chosen per language: Bulbul v4
// has Kavitha only in Telugu, so Hindi and English stay on v3 Kavitha (Saim, voice spike). The
// spike can override model and speaker. Text is never logged.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { LANGUAGE_CODES } from './translate.ts';

export const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
export const TTS_TIMEOUT_MS = 15_000;
/** Bulbul v3 takes up to 2,500 characters per request. */
export const MAX_TTS_CHARS = 2500;

export interface VoiceSetting {
  readonly model: string;
  readonly speaker: string;
}

/** M6 Decision 3: one voice per reply language (Saim's choice after hearing the spike samples). */
export const TTS_SETTINGS: Readonly<Record<Language, VoiceSetting>> = {
  te: { model: 'bulbul:v4-flash', speaker: 'kavitha_te_conversation' },
  hi: { model: 'bulbul:v3', speaker: 'kavitha' },
  en: { model: 'bulbul:v3', speaker: 'kavitha' },
};

export interface TtsConfig {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
  readonly model?: string;
  readonly speaker?: string;
}

export type Speaker = (text: string, language: Language) => Promise<Uint8Array<ArrayBuffer> | null>;

/** One text in, one audio out (base64). */
const TtsReply = z.object({ audios: z.tuple([z.string().min(1)], z.string()) });

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

/** MP3 bytes for the text, or null (logged) on any failure: a voice reply is best effort. */
export function createSpeaker(config: TtsConfig): Speaker {
  return async function speak(text, language): Promise<Uint8Array<ArrayBuffer> | null> {
    const input = text.trim().slice(0, MAX_TTS_CHARS);
    if (input === '') return null;
    try {
      const response = await config.fetchImpl(SARVAM_TTS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-subscription-key': config.apiKey },
        body: JSON.stringify({
          text: input,
          target_language_code: LANGUAGE_CODES[language],
          model: config.model ?? TTS_SETTINGS[language].model,
          speaker: config.speaker ?? TTS_SETTINGS[language].speaker,
          output_audio_codec: 'mp3',
        }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
      if (!response.ok) {
        config.log('warn', 'tts_failed', { error: 'http', status: response.status });
        return null;
      }
      const [audio] = TtsReply.parse(await response.json()).audios;
      return fromBase64(audio);
    } catch (error) {
      config.log('warn', 'tts_failed', { error: errorName(error), status: null });
      return null;
    }
  };
}
