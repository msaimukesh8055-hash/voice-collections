// supabase/functions/whatsapp-webhook/route.ts
// One owner message → replies. Button taps run from a typed map (taps.ts); text goes through
// the brain (fixed commands first, then the LLM) and the resulting command runs from a typed
// lookup map (run-command.ts). A voice note (M6) is heard first (Saaras) and then takes exactly
// the text path, in the language Saaras detected; its replies start with "🎤 Heard: …" so a
// misheard name is seen. M7: a voice reply's summary is checked against every known name.
// 2026-11-08: "call Munshi" and "/" commands are answered in code first (slash.ts), before any
// name lookup or LLM.
import { detectLanguage } from '../_shared/brain/language.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import type { BotContext } from '../_shared/cards/context.ts';
import type { MessagePath } from '../_shared/db/book-repository.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { blocks, hasText, type Reply, textReply } from '../_shared/whatsapp/replies.ts';
import { didNotGet, runCommand } from './run-command.ts';
import { routeEarly, understand } from './slash.ts';
import { runTap } from './taps.ts';

export interface Outcome {
  readonly replies: readonly Reply[];
  readonly path: MessagePath;
  /** What was asked (command kind or tap kind) for the message log; never the text. */
  readonly command: string | null;
  /** Set when the owner sent a voice note that was heard: the voice reply's language (M6). */
  readonly speakIn?: Language;
  /** M7: names the spoken summary is checked against (owner, shopkeepers, shops). */
  readonly speakNames?: readonly string[];
}

export interface RouteDeps {
  readonly llm: BrainLlm;
  /** Demo-clock "now", for the LLM prompt's date. */
  readonly demoNow: Date;
  /** Voice note → what was said (M6); called only for voice messages. */
  readonly hear: (mediaId: string) => Promise<Hearing>;
}

interface Said {
  readonly text: string;
  /** A voice note's language from Saaras wins over guessing from the words. */
  readonly spoken?: Language;
}

/**
 * A voice note's language from Saaras wins, except that Saaras' translit mode can report "en"
 * for Latin-letter Hindi or Telugu ("Salim ne 1,000 rupaye diye", dry-run fix 3): then the words
 * decide, so the card comes back in Hindi rather than English.
 */
export function replyLanguage(spoken: Language | undefined, fromWords: Language): Language {
  if (spoken === undefined) return fromWords;
  return spoken === 'en' && fromWords !== 'en' ? fromWords : spoken;
}

async function routeText(
  { text, spoken }: Said,
  ctx: BotContext,
  deps: RouteDeps,
): Promise<Outcome> {
  const early = await routeEarly(
    text,
    { ...ctx, language: replyLanguage(spoken, detectLanguage(text)) },
    deps,
  );
  if (early) return early;
  const understood = await understand(text, ctx, deps);
  const language = replyLanguage(spoken, understood.language);
  const withLanguage = { ...ctx, language };
  if (!understood.command) {
    return { replies: didNotGet(ctx, language), path: understood.path, command: 'unknown' };
  }
  const replies = await runCommand(understood.command, withLanguage);
  return { replies, path: understood.path, command: understood.command.kind };
}

async function routeTap(buttonId: string, ctx: BotContext): Promise<Outcome> {
  const { replies, command } = await runTap(buttonId, ctx);
  return { replies, path: 'button', command };
}

/** What Saaras heard is shown at most this long (a 30 s note is ~400 characters). */
export const MAX_HEARD_CHARS = 300;

function heardLine(text: string, language: Language): string {
  const shown = text.length > MAX_HEARD_CHARS ? `${text.slice(0, MAX_HEARD_CHARS - 1)}…` : text;
  return `${phrasesFor(language).heard}: “${shown}”`;
}

/** The Heard line in the reply's language and, for the twin, in English (what was heard stays
 * as heard; the twin translates it as free text). */
export interface HeardLine {
  readonly line: string;
  readonly english: string;
}

/** Puts the "Heard" line on top of the first reply that has a body. */
export function withHeard(replies: readonly Reply[], heard: HeardLine): readonly Reply[] {
  const [first, ...rest] = replies;
  if (!first || !hasText(first) || first.kind === 'template') {
    const alone: Reply = heard.line === heard.english
      ? textReply(heard.line)
      : { kind: 'text', text: heard.line, english: heard.english };
    return [alone, ...replies];
  }
  const english = first.english === undefined ? {} : {
    english: blocks(heard.english, first.english),
  };
  return [{ ...first, text: blocks(heard.line, first.text), ...english }, ...rest];
}

/** Every name a voice summary might say: the owner, each shopkeeper and each shop. */
function knownNames(ctx: BotContext): readonly string[] {
  const shops = ctx.shopkeepers.flatMap((shopkeeper) => [shopkeeper.name, shopkeeper.shopName]);
  return [ctx.owner.name, ctx.owner.businessName, ...shops];
}

async function routeVoice(mediaId: string, ctx: BotContext, deps: RouteDeps): Promise<Outcome> {
  const heard = await deps.hear(mediaId);
  if (heard.kind !== 'heard') {
    const replies = [textReply(phrasesFor(ctx.language).voiceProblem[heard.kind])];
    return { replies, path: 'command', command: `voice_${heard.kind}` };
  }
  const outcome = await routeText({ text: heard.text, spoken: heard.language }, ctx, deps);
  const line = {
    line: heardLine(heard.text, heard.language),
    english: heardLine(heard.text, 'en'),
  };
  const replies = withHeard(outcome.replies, line);
  return { ...outcome, replies, speakIn: heard.language, speakNames: knownNames(ctx) };
}

export function routeMessage(
  message: InboundMessage,
  ctx: BotContext,
  deps: RouteDeps,
): Promise<Outcome> {
  if (message.kind === 'tap') return routeTap(message.buttonId, ctx);
  if (message.kind === 'text') return routeText({ text: message.text }, ctx, deps);
  if (message.kind === 'voice') return routeVoice(message.mediaId, ctx, deps);
  const replies = [textReply(phrasesFor(ctx.language).textOnly)];
  return Promise.resolve({ replies, path: 'command', command: 'unsupported' });
}
