// supabase/functions/_shared/speech/transcript-english.ts
// English for a call's transcript on the dashboard (M6 Decision 4): each Telugu- or Hindi-script
// line goes through Sarvam Translate (names and amounts protected); lines already in English
// letters are left as they are (null). All lines are translated in parallel.
import { DEVANAGARI_SCRIPT, TELUGU_SCRIPT } from '../brain/language.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { Translator } from './translate.ts';

/** The script a line is written in, if it needs translating. */
export function scriptLanguage(text: string): Language | null {
  if (TELUGU_SCRIPT.test(text)) return 'te';
  if (DEVANAGARI_SCRIPT.test(text)) return 'hi';
  return null;
}

export function needsEnglish(turns: readonly Turn[]): boolean {
  return turns.some((turn) => scriptLanguage(turn.content) !== null);
}

export function englishLines(
  turns: readonly Turn[],
  translate: Translator,
  keep: readonly string[],
): Promise<(string | null)[]> {
  return Promise.all(turns.map(function english(turn): Promise<string | null> {
    const from = scriptLanguage(turn.content);
    if (from === null) return Promise.resolve(null);
    return translate({ text: turn.content, from, to: 'en', keep });
  }));
}
