// supabase/functions/_shared/brain/interpret.ts
// Code first, LLM second (ADR-0014): a fixed command answers at once and for free. A bare word
// that is not a known shopkeeper ("thanks", "ok") is not trusted as a lookup and goes to the LLM.
// The path that understood the message is returned so M7's evals can measure it.
import type { Language } from '../schemas/shopkeeper.ts';
import { amountsIn } from './amounts.ts';
import { type Command, isPromiseToPay, parseCommand } from './commands.ts';
import { asciiDigits } from './devanagari.ts';
import { detectLanguage, hasIndicScript } from './language.ts';
import type { BrainLlm, LlmPath } from './llm.ts';
import { toCommand } from './suggestion.ts';

export type InterpretPath = 'command' | LlmPath;

export interface Interpretation {
  readonly command: Command | null;
  readonly path: InterpretPath;
  readonly language: Language;
}

export interface InterpretDeps {
  readonly today: string;
  /** Demo-clock "now", for the prompt's date. */
  readonly now: Date;
  readonly llm: BrainLlm;
  readonly isKnownName: (name: string) => boolean;
}

/** Commands whose only content is a name: an unknown name ("remind me later") goes to the LLM. */
const NAME_ONLY_KINDS: ReadonlySet<Command['kind']> = new Set([
  'lookup',
  'remind',
  'score',
  'call_request',
]);

function hasName(command: Command): command is Extract<Command, { name: string }> {
  return NAME_ONLY_KINDS.has(command.kind);
}

/** A name read from Devanagari letters is a guess at the spelling: trusted only if it is known. */
function needsKnownName(
  command: Command,
  text: string,
): command is Extract<Command, { name: string }> {
  return hasName(command) || ('name' in command && hasIndicScript(text));
}

/**
 * Dry-run fix 3: when the owner wrote the amount in figures, the LLM's amount must be one of
 * them, so "1,000" can never come back as 10,000. With no figures ("ek hazaar") it is not checked.
 */
export function keepsWrittenAmount(command: Command | null, text: string): Command | null {
  if (command === null || !('amount' in command)) return command;
  const written = amountsIn(asciiDigits(text));
  return written.length === 0 || written.includes(command.amount) ? command : null;
}

const MONEY_KINDS: ReadonlySet<Command['kind']> = new Set(['add_credit', 'mark_paid']);

/** A promise to pay later is never a money card, even when the model suggests one. */
export function notAPromise(command: Command | null, text: string): Command | null {
  if (command === null || !MONEY_KINDS.has(command.kind)) return command;
  return isPromiseToPay(text) ? null : command;
}

export async function interpret(text: string, deps: InterpretDeps): Promise<Interpretation> {
  const language = detectLanguage(text);
  const command = parseCommand(text, deps.today);
  const trusted = command !== null &&
    (!needsKnownName(command, text) || deps.isKnownName(command.name));
  if (trusted) return { command, path: 'command', language };
  const result = await deps.llm(text, deps.now);
  const suggested = result.suggestion ? toCommand(result.suggestion, deps.today) : null;
  const checked = notAPromise(keepsWrittenAmount(suggested, text), text);
  return { command: checked, path: result.path, language };
}
