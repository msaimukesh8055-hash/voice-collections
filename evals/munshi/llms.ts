// evals/munshi/llms.ts
// Which models play which part in Munshi's text evals (M8 C1):
//   - live: Munshi on Sarvam sarvam-105b (reasoning off, as everywhere else). The simulated owner
//     and the judge are on Sarvam too by default (M9 Build F: Gemini's free quota ran out mid-run
//     on 2026-11-08). `--judge gemini` puts them back on Gemini (owner falls back to Sarvam) for an
//     independent judge; Gemini's free tier allows ~10 requests a minute, so its calls are spaced
//     out (GEMINI_MIN_GAP_MS). Keys go in headers only.
//   - dry: fake models, no network at all (used by `--dry` and the unit tests). The fake owner
//     says the scenario's lines then goodbye; the fake Munshi looks up the overview once, asks
//     the closing question in the owner's language, and says bye. A dry run checks the plumbing,
//     not Munshi: its scenario-specific checks are expected to fail.
import {
  askGeminiChat,
  askSarvamChat,
  type ChatRequest,
  type JsonLlmConfig,
} from '../../supabase/functions/_shared/llm/json-llm.ts';
import type { Language } from '../../supabase/functions/_shared/schemas/shopkeeper.ts';
import type { ChatProvider } from '../../supabase/functions/_shared/simulator/run.ts';
import type { MunshiScenario } from './types.ts';

/** 60 s / 10 requests, plus a margin. */
export const GEMINI_MIN_GAP_MS = 6_500;

export interface EvalModels {
  /** Always Sarvam on a live run (the product being shown). */
  readonly munshi: ChatProvider;
  /** Tried in order. */
  readonly owner: readonly ChatProvider[];
  readonly judge: ChatProvider;
}

export interface Pacing {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** Calls through `provider` start at least `gapMs` apart (one shared queue). */
export function spacedOut(provider: ChatProvider, gapMs: number, pacing: Pacing): ChatProvider {
  let nextAt = 0;
  return {
    name: provider.name,
    async ask(request): Promise<string> {
      const wait = nextAt - pacing.now();
      nextAt = Math.max(nextAt, pacing.now()) + gapMs;
      if (wait > 0) await pacing.sleep(wait);
      return provider.ask(request);
    },
  };
}

/**
 * Gemini answers the owner's turns in JSON mode; Sarvam has no JSON mode and often replies with
 * the bare line ("Add 5000 credit for Ramesh."), which the turn loop would count as a failed
 * owner (seen 2026-11-15). A reply with no JSON object is wrapped as the owner's line; a reply
 * that has one is passed on untouched, so its hang_up still counts. Sarvam also sometimes
 * returns an empty reply: that throws, so the turn loop tries the next provider (Sarvam again).
 * Its replies can also carry the model's own control tokens ("<|tool_call_end|>", seen
 * 2026-11-15), which Munshi would hear as words: they are removed first.
 */
/** Model control tokens like <|tool_call_end|>: never part of what a person says. */
const CONTROL_TOKEN = /<\|[^|<>]*\|>/g;

export function withoutControlTokens(text: string): string {
  return text.replace(CONTROL_TOKEN, '').trim();
}

export function ownerLineAsJson(provider: ChatProvider): ChatProvider {
  return {
    name: provider.name,
    async ask(request): Promise<string> {
      const raw = withoutControlTokens(await provider.ask(request));
      const line = raw.trim();
      if (line === '') throw new Error('empty owner reply');
      if (line.includes('{')) return raw;
      return JSON.stringify({ say: line, hang_up: false });
    },
  };
}

/** Who plays the owner and judges: Sarvam (default) or Gemini (an independent judge). */
export type SideModel = 'sarvam' | 'gemini';

export function liveModels(
  config: JsonLlmConfig,
  pacing: Pacing,
  side: SideModel = 'sarvam',
): EvalModels {
  const sarvam: ChatProvider = { name: 'sarvam', ask: (request) => askSarvamChat(config, request) };
  const sarvamOwner = ownerLineAsJson(sarvam);
  // Tried twice: an empty reply or one network error is not the owner hanging up.
  if (side === 'sarvam')
    return { munshi: sarvam, owner: [sarvamOwner, sarvamOwner], judge: sarvam };
  const gemini = spacedOut(
    { name: 'gemini', ask: (request) => askGeminiChat(config, request) },
    GEMINI_MIN_GAP_MS,
    pacing,
  );
  return { munshi: sarvam, owner: [gemini, sarvamOwner], judge: gemini };
}

/** What the fake owner says after his scripted lines. */
export const DRY_GOODBYE = 'No, nothing else. Bye.';
/** Fake Munshi's closing question, in the owner's script (so a dry run passes the script check). */
const DRY_CLOSING: Readonly<Record<Language, string>> = {
  te: 'ఇంకేమైనా ఉందా అన్నా?', // "Anything else, anna?"
  hi: 'और कुछ भाई?', // "Anything else, bhai?"
  en: 'Anything else, Srinivas?',
};
const DRY_BYE: Readonly<Record<Language, string>> = {
  te: 'సరే అన్నా, ఉంటాను.', // "OK anna, bye."
  hi: 'ठीक है भाई, चलता हूँ।', // "OK bhai, bye."
  en: 'Okay Srinivas, bye!',
};

function move(say: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ say, tool: null, end_call: false, ...extra });
}

/** The fake Munshi: overview once, then the closing question, then bye after his goodbye. */
function dryMunshi(language: Language): ChatProvider {
  return {
    name: 'sarvam',
    ask(request: ChatRequest): Promise<string> {
      const last = request.messages.at(-1);
      const usedTool = request.messages.some((message) => message.role === 'tool');
      if (last?.content.endsWith(DRY_GOODBYE))
        return Promise.resolve(move(DRY_BYE[language], { end_call: true }));
      if (usedTool) return Promise.resolve(move(DRY_CLOSING[language]));
      return Promise.resolve(
        move('', { tool: { name: 'book_summary', args: { focus: 'overview' } } }),
      );
    },
  };
}

/** The fake owner: the scenario's lines in order, then goodbye. */
function dryOwner(lines: readonly string[]): ChatProvider {
  return {
    name: 'gemini',
    ask(request: ChatRequest): Promise<string> {
      const said = request.messages.filter((message) => message.role === 'assistant').length;
      return Promise.resolve(JSON.stringify({ say: lines[said] ?? DRY_GOODBYE, hang_up: false }));
    },
  };
}

const DRY_JUDGE: ChatProvider = {
  name: 'gemini',
  ask: () => Promise.resolve('{"casual": 4, "language_match": 4, "clarity": 4, "note": "dry run"}'),
};

export function dryModels(scenario: MunshiScenario): EvalModels {
  return {
    munshi: dryMunshi(scenario.language),
    owner: [dryOwner(scenario.owner.scriptedLines)],
    judge: DRY_JUDGE,
  };
}
