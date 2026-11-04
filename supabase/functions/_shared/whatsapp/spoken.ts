// supabase/functions/_shared/whatsapp/spoken.ts
// The short spoken version of a reply, for the Bulbul voice note (M6 Decision 3). Not the whole
// message: the "Heard" line is dropped (he just said it), formatting and emoji are removed,
// "₹5,000" is read as "5,000 rupees", and a numbered list keeps only its first 3 rows. Figures
// always stay in the text message too (SPEC §6.7). ⚠️ The rupee words are drafts for Saim.
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from './phrases.ts';
import { hasText, type Reply } from './replies.ts';

/** Spoken rows of a numbered list (pending, due alert). */
export const SPOKEN_LIST_ROWS = 3;
/** About 40 seconds of speech; Bulbul's own limit is 2,500. */
export const MAX_SPOKEN_CHARS = 600;

const RUPEES: Readonly<Record<Language, string>> = {
  en: 'rupees',
  hi: 'रुपये',
  te: 'రూపాయలు',
};

const LIST_ROW = /^\d+\.\s/;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/gu;

function cleanLine(line: string, language: Language): string {
  return line
    .replace(EMOJI, '')
    .replace(/[*_~]/g, '')
    .replace(/^•\s*/, '')
    .replace(/₹\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)/g, `$1 ${RUPEES[language]}`)
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps the first rows of each numbered list; drops the rest. */
function shortLists(lines: readonly string[]): string[] {
  let rowsSeen = 0;
  return lines.filter(function keep(line): boolean {
    if (!LIST_ROW.test(line)) {
      rowsSeen = 0;
      return true;
    }
    rowsSeen += 1;
    return rowsSeen <= SPOKEN_LIST_ROWS;
  });
}

/** One sentence per line, so Bulbul pauses between them. */
function asSentences(lines: readonly string[]): string {
  return lines.map((line) => (/[.?!।:]$/.test(line) ? line : `${line}.`)).join(' ');
}

/** What the voice note says for these replies, in the reply language ('' = nothing to say). */
export function spokenText(replies: readonly Reply[], language: Language): string {
  const first = replies.filter(hasText).find((reply) => reply.kind !== 'template');
  if (!first) return '';
  const heard = phrasesFor(language).heard;
  const body = first.text.split('\n\n').filter((block) => !block.startsWith(heard)).join('\n');
  const lines = shortLists(body.split('\n'))
    .map((line) => cleanLine(line, language))
    .filter((line) => line !== '');
  const text = asSentences(lines);
  return text.length > MAX_SPOKEN_CHARS ? `${text.slice(0, MAX_SPOKEN_CHARS - 1)}…` : text;
}
