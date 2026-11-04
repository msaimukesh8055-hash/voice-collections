// supabase/functions/_shared/whatsapp/english-twin.ts
// "English under Telugu" (M6 Decision 5, Saim chose Sarvam Translate on 2026-11-04): when the
// owner's demo setting is on, every bot message with Telugu in it is followed by a blank line and
// its English translation. It wraps the WhatsApp sender, so replies, after-call summaries and the
// daily alert all get it in one place. Names and amounts are protected by the translator's
// markers. Buttons and list rows stay Telugu (WhatsApp allows 20–24 characters there). If the
// pair is too long for one message, the English goes in a second message right after. If
// Translate fails, the Telugu message goes out alone: the twin never blocks a reply.
// The bot's own Telugu labels get their fixed English from phrases.ts first (fixed-english.ts);
// a paragraph with no Telugu left is used as it is, with no Translate call.
// Dry-run fix 4: a message built from a template (due alert, pending, closed, insights, cards,
// call summary…) carries its own English rendering (`reply.english`, same template and data in
// English), used as it is. Translate then only sees what is still Telugu in it: free text such as
// a note or what Saaras heard, one line at a time so the layout is kept.
import { TELUGU_SCRIPT } from '../brain/language.ts';
import type { BookRepository } from '../db/book-repository.ts';
import type { Translator } from '../speech/translate.ts';
import type { WhatsAppClient } from './client.ts';
import { withFixedEnglish } from './fixed-english.ts';
import { blocks, type BodiedReply, isBodied, type Reply, textReply } from './replies.ts';

/** Meta's limits: plain text 4,096 characters; the body of a message with buttons or a list
 * 1,024. */
const TEXT_LIMIT = 4096;
const INTERACTIVE_LIMIT = 1024;
/** Names (shopkeepers, the owner) are read at most this often. */
export const SETTINGS_TTL_MS = 5 * 60_000;

export interface TwinSettings {
  readonly on: boolean;
  /** Names to keep exactly as written. */
  readonly names: readonly string[];
}

export interface EnglishTwinDeps {
  readonly translate: Translator;
  readonly loadSettings: () => Promise<TwinSettings>;
  readonly clock: () => Date;
}

type Bodied = BodiedReply;

function hasTelugu(reply: Reply): reply is Bodied {
  return isBodied(reply) && TELUGU_SCRIPT.test(reply.text);
}

/** A template's English rendering: only lines still in Telugu (free text) go to Translate. A
 * line Translate cannot do stays as it is; the rest of the English is already right. */
async function finishRendered(
  english: string,
  deps: EnglishTwinDeps,
  names: readonly string[],
): Promise<string> {
  const lines = await Promise.all(
    english.split('\n').map(async function lineInEnglish(line): Promise<string> {
      if (!TELUGU_SCRIPT.test(line)) return line;
      const translated = await deps.translate({ text: line, from: 'te', to: 'en', keep: names });
      return translated ?? line;
    }),
  );
  return lines.join('\n');
}

function twinOf(
  reply: Bodied,
  deps: EnglishTwinDeps,
  names: readonly string[],
): Promise<string | null> {
  return reply.english === undefined
    ? englishOf(reply.text, deps, names)
    : finishRendered(reply.english, deps, names);
}

/** Each block (paragraph) on its own, so a long list stays under Translate's 1,000 characters
 * per request; any block failing means no twin at all (never a half translation). */
async function englishOf(
  text: string,
  deps: EnglishTwinDeps,
  names: readonly string[],
): Promise<string | null> {
  const parts = await Promise.all(
    text.split('\n\n').map(function englishOfPart(part): Promise<string | null> {
      const fixed = withFixedEnglish(part);
      if (!TELUGU_SCRIPT.test(fixed.text)) return Promise.resolve(fixed.text);
      const keep = [...names, ...fixed.labels];
      return deps.translate({ text: fixed.text, from: 'te', to: 'en', keep });
    }),
  );
  return parts.some((part) => part === null) ? null : blocks(...parts);
}

/** The Telugu message with its English under it, or (too long) the English as a second one. */
function paired(reply: Bodied, english: string): { first: Reply; extra: Reply | null } {
  const text = blocks(reply.text, english);
  const limit = reply.kind === 'text' ? TEXT_LIMIT : INTERACTIVE_LIMIT;
  if (text.length <= limit) return { first: { ...reply, text }, extra: null };
  return { first: reply, extra: textReply(english) };
}

function cachedSettings(deps: EnglishTwinDeps): () => Promise<TwinSettings> {
  let cached: { settings: TwinSettings; at: number } | null = null;
  return async function settings(): Promise<TwinSettings> {
    const now = deps.clock().getTime();
    if (cached && now - cached.at < SETTINGS_TTL_MS) return cached.settings;
    cached = { settings: await deps.loadSettings(), at: now };
    return cached.settings;
  };
}

export function withEnglishTwin(client: WhatsAppClient, deps: EnglishTwinDeps): WhatsAppClient {
  const settings = cachedSettings(deps);
  return {
    async send(to: string, reply: Reply): Promise<string | null> {
      if (!hasTelugu(reply)) return await client.send(to, reply);
      const current = await settings().catch(() => ({ on: false, names: [] }));
      if (!current.on) return await client.send(to, reply);
      const english = await twinOf(reply, deps, current.names);
      if (english === null) return await client.send(to, reply);
      const { first, extra } = paired(reply, english);
      const id = await client.send(to, first);
      if (extra) await client.send(to, extra);
      return id;
    },
  };
}

/** The owner's setting, plus every name to protect: the owner, shopkeepers and shop names. */
export function ownerTwinSettings(
  book: Pick<BookRepository, 'getOwner' | 'listShopkeepers'>,
): () => Promise<TwinSettings> {
  return async function load(): Promise<TwinSettings> {
    const owner = await book.getOwner();
    if (!owner?.englishUnderTelugu) return { on: false, names: [] };
    const shopkeepers = await book.listShopkeepers(owner.id);
    const names = shopkeepers.flatMap((shopkeeper) => [shopkeeper.name, shopkeeper.shopName]);
    return { on: true, names: [owner.name, owner.businessName, ...names] };
  };
}
