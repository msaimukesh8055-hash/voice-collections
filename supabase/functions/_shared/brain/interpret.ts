// supabase/functions/_shared/brain/interpret.ts
// Code first, LLM second (ADR-0014): a fixed command answers at once and for free. A bare word
// that is not a known shopkeeper ("thanks", "ok") is not trusted as a lookup and goes to the LLM.
// The path that understood the message is returned so M7's evals can measure it.
import type { Language } from '../schemas/shopkeeper.ts';
import { type Command, parseCommand } from './commands.ts';
import { detectLanguage } from './language.ts';
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

export async function interpret(text: string, deps: InterpretDeps): Promise<Interpretation> {
  const language = detectLanguage(text);
  const command = parseCommand(text, deps.today);
  const trusted = command !== null && (command.kind !== 'lookup' || deps.isKnownName(command.name));
  if (trusted) return { command, path: 'command', language };
  const result = await deps.llm(text, deps.now);
  const suggested = result.suggestion ? toCommand(result.suggestion, deps.today) : null;
  return { command: suggested, path: result.path, language };
}
