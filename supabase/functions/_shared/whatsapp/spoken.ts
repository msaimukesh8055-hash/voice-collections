// supabase/functions/_shared/whatsapp/spoken.ts
// The short spoken version of a reply, for the Bulbul voice note (M6 Decision 3). Not the whole
// message: the "Heard" line is dropped (he just said it), formatting and emoji are removed,
// "₹5,000" is read as "5,000 rupees", and a numbered list keeps only its first 3 rows. Figures
// always stay in the text message too (SPEC §6.7). ⚠️ The rupee words are drafts for Saim.
// A line with a link in it ("📒 View in books: https://…", "📞 Answer here: …") is never read
// aloud (reply links, cloud build): the link is for tapping, in the text message.
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from './phrases.ts';
import { type BodiedReply, isBodied, type Reply } from './replies.ts';

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
const LINK = /https?:\/\//i;
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

/** The reply's lines without the "Heard" block and without link lines: what may be spoken. */
export function speakableLines(text: string, language: Language): readonly string[] {
  const heard = phrasesFor(language).heard;
  const body = text.split('\n\n').filter((block) => !block.startsWith(heard)).join('\n');
  return body.split('\n').filter((line) => !LINK.test(line));
}

/** Bodied replies the voice note may speak about (never a template or a voice note). */
function speakable(replies: readonly Reply[]): readonly BodiedReply[] {
  return replies.filter(isBodied);
}

/** What the voice note says for these replies, in the reply language ('' = nothing to say). */
export function spokenText(replies: readonly Reply[], language: Language): string {
  const first = speakable(replies)[0];
  if (!first) return '';
  const lines = shortLists(speakableLines(first.text, language))
    .map((line) => cleanLine(line, language))
    .filter((line) => line !== '');
  const text = asSentences(lines);
  return text.length > MAX_SPOKEN_CHARS ? `${text.slice(0, MAX_SPOKEN_CHARS - 1)}…` : text;
}

/** What the summary LLM is given (M7 Decision 4): every bodied reply's speakable lines (a list's
 * rows too) and the titles he can tap. The safety checks compare the summary with this. */
export interface SpokenSource {
  readonly reply: string;
  readonly buttons: readonly string[];
}

function tapTitles(reply: BodiedReply): readonly string[] {
  if (reply.kind === 'buttons') return reply.buttons.map((button) => button.title);
  return reply.kind === 'list' ? [reply.buttonLabel] : [];
}

function rowLines(reply: BodiedReply): readonly string[] {
  if (reply.kind !== 'list') return [];
  return reply.rows.map((row) => [row.title, row.description].filter(Boolean).join(' · '));
}

function withoutEmoji(title: string): string {
  return title.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
}

export function spokenSource(replies: readonly Reply[], language: Language): SpokenSource {
  const bodied = speakable(replies);
  const parts = bodied.map((reply) =>
    [...speakableLines(reply.text, language), ...rowLines(reply)].join('\n').trim()
  );
  return {
    reply: parts.filter((part) => part !== '').join('\n\n'),
    buttons: bodied.flatMap(tapTitles).map(withoutEmoji).filter((title) => title !== ''),
  };
}

/** The source as one text for the checks: the reply, then each button title on its own line. */
export function sourceText(source: SpokenSource): string {
  return [source.reply, ...source.buttons].join('\n');
}
