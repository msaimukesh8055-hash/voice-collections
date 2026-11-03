// supabase/functions/_shared/llm/json-llm.ts
// One JSON answer from an LLM (ADR-0014): Sarvam sarvam-105b first; on an error, a timeout (8 s)
// or an answer the caller's parser rejects, the same prompt goes to Gemini; if that fails too,
// the caller gets `value: null` and uses its own safe default. Used by the WhatsApp brain (M4)
// and the follow-up agent and note writer (M5). Logs hold the event, provider, outcome and
// timing only, never the prompt or the answer (they carry names and amounts).
// Checked against the live APIs on 2026-11-02: sarvam-105b is a reasoning model, and
// `reasoning_effort: null` turns reasoning off (~0.5 s, clean JSON; with reasoning on it spent
// 400 tokens thinking and returned nothing). Gemini 2.5 Flash with thinking off: ~1.3 s.
import { z } from 'zod';
import type { Logger } from '../log.ts';

export const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
export const SARVAM_MODEL = 'sarvam-105b';
export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
export const LLM_TIMEOUT_MS = 8_000;
/** One small JSON object; a cap keeps a runaway answer cheap. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 300;

export type LlmProvider = 'sarvam' | 'gemini';
export type LlmPath = LlmProvider | 'failed';

export interface JsonLlmConfig {
  readonly sarvamApiKey: string;
  readonly geminiApiKey: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
}

export interface JsonRequest<T> {
  /** Log event name, e.g. "brain_llm". */
  readonly event: string;
  readonly system: string;
  readonly message: string;
  /** Text → checked value, or null when the answer is unusable (then the next provider). */
  readonly parse: (content: string) => T | null;
  readonly maxTokens?: number;
}

export type JsonAnswer<T> =
  | { readonly value: T; readonly path: LlmProvider }
  | { readonly value: null; readonly path: 'failed' };

export type JsonLlm = <T>(request: JsonRequest<T>) => Promise<JsonAnswer<T>>;

interface Prompt {
  readonly system: string;
  readonly message: string;
  readonly maxTokens: number;
}

type Provider = (prompt: Prompt) => Promise<string>;

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

/** The one JSON object in an answer, checked with `schema`; tolerates code fences and stray
 * words around it. Null when there is none or it does not match. */
export function extractJson<T>(content: string, schema: z.ZodType<T>): T | null {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(content.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // Not JSON at all: treated like any other bad answer (fallback).
  }
}

async function postJson(
  config: JsonLlmConfig,
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

/** One turn of a conversation: "user" is the other side, "assistant" is the model itself. */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  /** 0 for checked answers (default); higher for a simulated shopkeeper's natural replies. */
  readonly temperature?: number;
}

/** Raw text of one multi-turn answer from sarvam-105b (reasoning off). Throws on an HTTP error,
 * a timeout or an unexpected body; the caller decides what a failure means. */
export async function askSarvamChat(config: JsonLlmConfig, request: ChatRequest): Promise<string> {
  const body = {
    model: SARVAM_MODEL,
    messages: [{ role: 'system', content: request.system }, ...request.messages],
    temperature: request.temperature ?? 0,
    max_tokens: request.maxTokens,
    reasoning_effort: null,
  };
  const headers = { 'api-subscription-key': config.sarvamApiKey };
  const reply = SarvamReply.parse(await postJson(config, { url: SARVAM_CHAT_URL, headers, body }));
  return reply.choices[0]?.message.content ?? '';
}

/** As askSarvamChat, on Gemini 2.5 Flash (JSON mode, thinking off). Gemini calls the model's
 * own turns "model". */
export async function askGeminiChat(config: JsonLlmConfig, request: ChatRequest): Promise<string> {
  const body = {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    })),
    generationConfig: {
      temperature: request.temperature ?? 0,
      responseMimeType: 'application/json',
      maxOutputTokens: request.maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  // Key in a header, not the URL, so it can never appear in a logged URL.
  const headers = { 'x-goog-api-key': config.geminiApiKey };
  const reply = GeminiReply.parse(await postJson(config, { url: GEMINI_URL, headers, body }));
  return reply.candidates.flatMap((candidate) => candidate.content.parts)
    .map((part) => part.text ?? '').join('');
}

function oneMessage(prompt: Prompt): ChatRequest {
  return {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.message }],
    maxTokens: prompt.maxTokens,
  };
}

function sarvamProvider(config: JsonLlmConfig): Provider {
  return function askSarvam(prompt): Promise<string> {
    return askSarvamChat(config, oneMessage(prompt));
  };
}

function geminiProvider(config: JsonLlmConfig): Provider {
  return function askGemini(prompt): Promise<string> {
    return askGeminiChat(config, oneMessage(prompt));
  };
}

function failureOf(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof z.ZodError) return 'unexpected_shape';
  return error instanceof Error ? error.name : 'unknown';
}

async function tryProvider<T>(
  name: LlmProvider,
  ask: Provider,
  input: { request: JsonRequest<T>; log: Logger },
): Promise<T | null> {
  const { request, log } = input;
  const started = Date.now();
  const prompt = {
    system: request.system,
    message: request.message,
    maxTokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  };
  try {
    const value = request.parse(await ask(prompt));
    const fields = { provider: name, outcome: value ? 'ok' : 'bad_json', ms: Date.now() - started };
    log(value ? 'info' : 'warn', request.event, fields);
    return value;
  } catch (error) {
    log('warn', request.event, {
      provider: name,
      outcome: failureOf(error),
      ms: Date.now() - started,
    });
    return null;
  }
}

export function createJsonLlm(config: JsonLlmConfig): JsonLlm {
  const providers = [
    ['sarvam', sarvamProvider(config)],
    ['gemini', geminiProvider(config)],
  ] as const;
  return async function askJson<T>(request: JsonRequest<T>): Promise<JsonAnswer<T>> {
    for (const [name, ask] of providers) {
      const value = await tryProvider(name, ask, { request, log: config.log });
      if (value !== null) return { value, path: name };
    }
    return { value: null, path: 'failed' };
  };
}
