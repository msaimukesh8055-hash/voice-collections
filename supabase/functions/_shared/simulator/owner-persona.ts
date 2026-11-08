// supabase/functions/_shared/simulator/owner-persona.ts
// Owner persona prompt v1 (M8 C1), approved by Saim 2026-11-07 ("Approve all"). Word for word as
// in docs/milestones/M8.md "Owner persona prompt"; only {LANGUAGE}, {GOALS} and {SCRIPTED_LINES}
// are filled in per eval scenario. Gemini plays Srinivas talking to Munshi (Sarvam if Gemini
// fails). Everything is fictional: names and amounts come from the fake eval book.
import type { Language } from '../schemas/shopkeeper.ts';

export const OWNER_PERSONA_VERSION = 'v1';

/** {LANGUAGE}: how he speaks in each call language. ⚠️ Wording is Saim's (prompt text). */
export const OWNER_LANGUAGE_STYLE: Readonly<Record<Language, string>> = {
  te: 'Telugu, in Telugu script, mixed with everyday English words like credit, balance and entry',
  hi: 'Hindi, in Devanagari script, mixed with everyday English words like credit, balance and ' +
    'entry',
  en: 'simple Indian English',
};

export interface OwnerScript {
  readonly language: Language;
  /** What he wants from this call, in order. */
  readonly goals: readonly string[];
  /** Lines he must say word for word when the moment comes. */
  readonly scriptedLines: readonly string[];
}

const NO_SCRIPTED_LINES = 'none';

function numbered(goals: readonly string[]): string {
  return goals.map((goal, index) => `${index + 1}. ${goal}`).join(' ');
}

function quoted(lines: readonly string[]): string {
  if (lines.length === 0) return NO_SCRIPTED_LINES;
  return lines.map((line) => `"${line}"`).join(' ');
}

export function buildOwnerPersonaPrompt(script: OwnerScript): string {
  return `You are Srinivas Reddy, a wholesale trader in Anantapur, talking to Munshi, the helper who keeps your credit book, on a call. Speak like a busy shop owner: short, casual, sometimes code-mixed. Language: ${
    OWNER_LANGUAGE_STYLE[script.language]
  }.
Your goals for this call, in order: ${numbered(script.goals)}
Fixed lines you must say when the moment comes: ${quoted(script.scriptedLines)}
When Munshi reads something back, check it against your goals: say yes only if it matches, otherwise correct it. When your goals are done and he asks if there is anything else, say no and bye.
Answer with ONE JSON object: {"say": "<your words>", "hang_up": false}`;
}
