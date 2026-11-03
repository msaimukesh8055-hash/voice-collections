// supabase/functions/_shared/brain/llm.ts
// The LLM step of the brain (ADR-0014, M4 Decision 3): Sarvam sarvam-105b first; on an error, a
// timeout (8 s) or an answer that fails SuggestionSchema, the same prompt goes to Gemini; if that
// fails too, the caller says "Sorry, I didn't get that" + help. Logs hold provider, outcome and
// timing only, never the message or the answer (they carry names and amounts).
// Checked against the live APIs on 2026-11-02: sarvam-105b is a reasoning model, and
// `reasoning_effort: null` turns reasoning off (~0.5 s, clean JSON; with reasoning on it spent
// 400 tokens thinking and returned nothing). Gemini 2.5 Flash with thinking off: ~1.3 s.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import { buildBrainPrompt } from './prompt.ts';
import { parseSuggestion, type Suggestion } from './suggestion.ts';

export const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
export const SARVAM_BRAIN_MODEL = 'sarvam-105b';
export const GEMINI_BRAIN_MODEL = 'gemini-2.5-flash';
export const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_BRAIN_MODEL}:generateContent`;
export const LLM_TIMEOUT_MS = 8_000;
/** One small JSON object; a cap keeps a runaway answer cheap. */
const MAX_OUTPUT_TOKENS = 300;

export type LlmPath = 'sarvam' | 'gemini' | 'failed';

export interface LlmResult {
  readonly suggestion: Suggestion | null;
  readonly path: LlmPath;
}

export interface BrainLlmConfig {
  readonly sarvamApiKey: string;
  readonly geminiApiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
}

export type BrainLlm = (message: string, now: Date) => Promise<LlmResult>;

type Provider = (system: string, message: string) => Promise<string>;

const SarvamReply = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});
const GeminiReply = z.object({
  candidates: z.array(
    z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }) }),
  ).min(1),
});

class ProviderError extends Error {
  override name = 'ProviderError';
}

async function postJson(
  config: BrainLlmConfig,
  request: { url: string; headers: Record<string, string>; body: unknown },
): Promise<unknown> {
  const response = await config.fetchImpl(request.url, {
    method: 'POST',
    headers: { ...request.headers, 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!response.ok) throw new ProviderError(`HTTP ${response.status}`);
  return await response.json();
}

function sarvamProvider(config: BrainLlmConfig): Provider {
  return async function askSarvam(system, message): Promise<string> {
    const body = {
      model: SARVAM_BRAIN_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      reasoning_effort: null,
    };
    const headers = { 'api-subscription-key': config.sarvamApiKey };
    const reply = SarvamReply.parse(
      await postJson(config, { url: SARVAM_CHAT_URL, headers, body }),
    );
    return reply.choices[0]?.message.content ?? '';
  };
}

function geminiProvider(config: BrainLlmConfig): Provider {
  return async function askGemini(system, message): Promise<string> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    // Key in a header, not the URL, so it can never appear in a logged URL.
    const headers = { 'x-goog-api-key': config.geminiApiKey };
    const reply = GeminiReply.parse(await postJson(config, { url: GEMINI_URL, headers, body }));
    return reply.candidates.flatMap((candidate) => candidate.content.parts)
      .map((part) => part.text ?? '').join('');
  };
}

function failureOf(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof z.ZodError) return 'unexpected_shape';
  return error instanceof Error ? error.name : 'unknown';
}

async function tryProvider(
  name: Exclude<LlmPath, 'failed'>,
  ask: Provider,
  input: { system: string; message: string; log: Logger },
): Promise<Suggestion | null> {
  const started = Date.now();
  try {
    const suggestion = parseSuggestion(await ask(input.system, input.message));
    const outcome = suggestion ? 'ok' : 'bad_json';
    input.log(suggestion ? 'info' : 'warn', 'brain_llm', {
      provider: name,
      outcome,
      ms: Date.now() - started,
    });
    return suggestion;
  } catch (error) {
    input.log('warn', 'brain_llm', {
      provider: name,
      outcome: failureOf(error),
      ms: Date.now() - started,
    });
    return null;
  }
}

export function createBrainLlm(config: BrainLlmConfig): BrainLlm {
  const providers = [
    ['sarvam', sarvamProvider(config)],
    ['gemini', geminiProvider(config)],
  ] as const;
  return async function suggest(message, now): Promise<LlmResult> {
    const input = { system: buildBrainPrompt(now), message, log: config.log };
    for (const [name, ask] of providers) {
      const suggestion = await tryProvider(name, ask, input);
      if (suggestion) return { suggestion, path: name };
    }
    return { suggestion: null, path: 'failed' };
  };
}
