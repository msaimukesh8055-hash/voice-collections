// evals/munshi/llms.ts
// Which models play which part in Munshi's text evals (M8 C1):
//   - live: Munshi on Sarvam sarvam-105b (reasoning off, as everywhere else), the owner on Gemini
//     with Sarvam as fallback, the judge on Gemini. Gemini's free tier allows ~10 requests a
//     minute, so Gemini calls are spaced out (GEMINI_MIN_GAP_MS); keys go in headers only.
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

export function liveModels(config: JsonLlmConfig, pacing: Pacing): EvalModels {
  const sarvam: ChatProvider = { name: 'sarvam', ask: (request) => askSarvamChat(config, request) };
  const gemini = spacedOut(
    { name: 'gemini', ask: (request) => askGeminiChat(config, request) },
    GEMINI_MIN_GAP_MS,
    pacing,
  );
  return { munshi: sarvam, owner: [gemini, sarvam], judge: gemini };
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
