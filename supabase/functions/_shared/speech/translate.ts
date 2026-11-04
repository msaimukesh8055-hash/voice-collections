// supabase/functions/_shared/speech/translate.ts
// Sarvam Translate (mayura:v1), used live only for text we can't write in advance (M6
// Decision 4): the "Heard" line under a Telugu/Hindi voice note, and call transcripts on the
// dashboard. Names and amounts must come back unchanged, and Translate has no "keep this word"
// option, so they are swapped for markers (⟦1⟧, ⟦2⟧…) before sending and put back after. A
// translation that loses, repeats or invents a marker is thrown away (null): the caller then
// shows the original alone. Translate failing never blocks a reply. Logs never carry the text.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export const SARVAM_TRANSLATE_URL = 'https://api.sarvam.ai/translate';
export const TRANSLATE_MODEL = 'mayura:v1';
/** mayura:v1 takes at most 1,000 characters per request. */
export const MAX_TRANSLATE_CHARS = 1000;
export const TRANSLATE_TIMEOUT_MS = 6_000;

/** Wording style; a choice for Saim after he sees samples (M6 Decision 4). */
export type TranslateMode = 'code-mixed' | 'modern-colloquial' | 'formal';
export const DEFAULT_TRANSLATE_MODE: TranslateMode = 'code-mixed';

export const LANGUAGE_CODES: Readonly<Record<Language, string>> = {
  en: 'en-IN',
  hi: 'hi-IN',
  te: 'te-IN',
};

export interface TranslateConfig {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
  readonly mode?: TranslateMode;
}

export interface TranslateRequest {
  readonly text: string;
  readonly from: Language;
  readonly to: Language;
  /** Shopkeeper and owner names to keep exactly as written. */
  readonly keep: readonly string[];
}

export type Translator = (request: TranslateRequest) => Promise<string | null>;

/** Amounts and other figures: "₹1,84,000", "Rs. 500", "5,000", "2.5", "15th", "5k". */
const FIGURE = /(?:₹|Rs\.?\s?)?\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th|k|K)?/g;
const MARKER = /⟦(\d+)⟧/g;

export interface Masked {
  readonly text: string;
  /** Original words, in marker order (marker n = values[n - 1]). */
  readonly values: readonly string[];
}

function escapeForRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Swaps names (longest first, whole words, any case) and figures for numbered markers. */
export function mask(text: string, keep: readonly string[]): Masked {
  const values: string[] = [];
  const swap = (found: string): string => {
    values.push(found);
    return `⟦${values.length}⟧`;
  };
  const names = [...new Set(keep.map((name) => name.trim()).filter((name) => name.length > 1))]
    .sort((a, b) => b.length - a.length);
  let masked = text;
  for (const name of names) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeForRegex(name)}(?![\\p{L}\\p{N}])`,
      'giu',
    );
    masked = masked.replace(pattern, swap);
  }
  // Figures only outside markers already placed (a marker's own digits are not a figure).
  masked = masked.split(/(⟦\d+⟧)/).map(function maskFigures(part): string {
    return part.startsWith('⟦') ? part : part.replace(FIGURE, swap);
  }).join('');
  return { text: masked, values };
}

/** Puts the originals back; null when any marker is missing, repeated or unknown. */
export function unmask(translated: string, values: readonly string[]): string | null {
  const seen = [...translated.matchAll(MARKER)].map((match) => Number(match[1]));
  const expected = values.map((_, index) => index + 1);
  const sorted = [...seen].sort((a, b) => a - b);
  if (sorted.length !== expected.length || sorted.some((n, i) => n !== expected[i])) return null;
  // Every marker was checked above, so each number has its value.
  return translated.replace(MARKER, (_, n: string) => String(values[Number(n) - 1]));
}

const TranslateReply = z.object({ translated_text: z.string().min(1) });

async function callSarvam(
  config: TranslateConfig,
  input: string,
  request: TranslateRequest,
): Promise<string> {
  const response = await config.fetchImpl(SARVAM_TRANSLATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-subscription-key': config.apiKey },
    body: JSON.stringify({
      input,
      source_language_code: LANGUAGE_CODES[request.from],
      target_language_code: LANGUAGE_CODES[request.to],
      model: TRANSLATE_MODEL,
      mode: config.mode ?? DEFAULT_TRANSLATE_MODE,
      numerals_format: 'international',
    }),
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`http ${response.status}`);
  return TranslateReply.parse(await response.json()).translated_text;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}

export function createTranslator(config: TranslateConfig): Translator {
  return async function translate(request: TranslateRequest): Promise<string | null> {
    const text = request.text.trim();
    if (text === '' || request.from === request.to) return text;
    const masked = mask(text, request.keep);
    if (masked.text.length > MAX_TRANSLATE_CHARS) {
      config.log('warn', 'translate_too_long', { chars: masked.text.length });
      return null;
    }
    try {
      const restored = unmask(await callSarvam(config, masked.text, request), masked.values);
      if (restored === null) config.log('warn', 'translate_marker_lost', { to: request.to });
      return restored;
    } catch (error) {
      config.log('warn', 'translate_failed', { to: request.to, error: errorName(error) });
      return null;
    }
  };
}
