// supabase/functions/_shared/llm/langfuse.ts
// LLM tracing to Langfuse (interview step 6, Saim 2026-11-23; ADR-0023). Every LLM call our own
// code makes (json-llm.ts: the WhatsApp brain, the follow-up agent, simulated calls, the tone
// judge, the spoken summary) is sent to Langfuse as one OpenTelemetry span over plain HTTP
// (OTLP/HTTP JSON, no SDK): one trace keyed by our own trace_id, with one generation: model,
// prompt version, input, output, tokens, latency and cost in ₹ (metadata; Langfuse's own cost
// field is in USD). Langfuse removed its older /api/public/ingestion for traces on 2026-11-16.
//   Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are both set (LANGFUSE_HOST defaults to
//   Langfuse Cloud EU). Fire-and-forget: the send runs after the answer, never slows or breaks
//   the request, and a failed send is one warning in our logs.
//   LANGFUSE_REDACT=on masks names, phone numbers and amounts and leaves out the system prompt
//   (only its size is sent). Off by default: every name and amount in this pilot is fake.
// Asha's and Munshi's own model turns run inside Sarvam and are not traced here.
import { llmCost } from '../calls/cost.ts';
import { errorName, type Logger } from '../log.ts';

export const LANGFUSE_DEFAULT_HOST = 'https://cloud.langfuse.com';
/** OpenTelemetry traces endpoint: Langfuse switched off its older ingestion API on 2026-11-16. */
const OTLP_PATH = '/api/public/otel/v1/traces';
/** A slow Langfuse must never hold a function open for long. */
export const LANGFUSE_TIMEOUT_MS = 5_000;

export interface Generation {
  /** Our log event name, e.g. "brain_llm", or "chat" for a multi-turn call. */
  readonly name: string;
  readonly provider: 'sarvam' | 'gemini';
  readonly model: string;
  readonly promptVersion: string | null;
  readonly system: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  /** Null when the call failed. */
  readonly output: string | null;
  /** The failure's class name, never its message. */
  readonly error: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** Called once per LLM call, after it ends. Must not throw or wait. */
export type LlmObserver = (generation: Generation) => void;

export interface LangfuseEnv {
  readonly LANGFUSE_PUBLIC_KEY: string | null;
  readonly LANGFUSE_SECRET_KEY: string | null;
  readonly LANGFUSE_HOST: string | null;
  readonly LANGFUSE_REDACT: string | null;
}

export interface LangfuseDeps {
  readonly fetchImpl: typeof fetch;
  /** Keeps the function alive until the send ends (EdgeRuntime.waitUntil via tracing). */
  readonly defer: (task: Promise<unknown>) => void;
  readonly log: Logger;
  /** Our current trace id, so a Langfuse trace and our ops trace share one id. */
  readonly traceId: () => string | null;
  readonly newId: () => string;
}

export interface LangfuseSettings {
  readonly host: string;
  readonly publicKey: string;
  readonly secretKey: string;
  readonly redact: boolean;
}

/** Null (tracing off) unless both keys are set. */
export function langfuseSettings(env: LangfuseEnv): LangfuseSettings | null {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return null;
  return {
    host: (env.LANGFUSE_HOST ?? LANGFUSE_DEFAULT_HOST).replace(/\/+$/, ''),
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    redact: env.LANGFUSE_REDACT?.toLowerCase() === 'on',
  };
}

const NAME_FIELD = /("name"\s*:\s*")[^"]*(")/g;
/** A run of digits, with the separators amounts and phone numbers use (₹12,500 · 98765 43210). */
const NUMBER = /\d(?:[\d,.\s-]*\d)?/g;
/** Any capitalised Latin word: names here are written that way. It also masks the first word of
 * a sentence; masking too much is the safe side. */
const LATIN_NAME = /\b[A-Z][a-z]+\b/g;

/** Best-effort masking: numbers everywhere, JSON name fields, and capitalised Latin words. Names
 * written in Telugu or Hindi script are not detected; leave REDACT off only with fake data. */
export function redactText(text: string): string {
  return text.replace(NAME_FIELD, '$1[name]$2').replace(NUMBER, '#').replace(LATIN_NAME, '[name]');
}

function shown(settings: LangfuseSettings, generation: Generation): {
  readonly input: unknown;
  readonly output: string | null;
} {
  if (!settings.redact) {
    return {
      input: [{ role: 'system', content: generation.system }, ...generation.messages],
      output: generation.output,
    };
  }
  return {
    input: [
      {
        role: 'system',
        content: `[system prompt left out: ${generation.system.length} characters]`,
      },
      ...generation.messages.map((one) => ({ role: one.role, content: redactText(one.content) })),
    ],
    output: generation.output === null ? null : redactText(generation.output),
  };
}

function costInr(generation: Generation): number | null {
  if (generation.tokensIn === null || generation.tokensOut === null) return null;
  return llmCost(generation.provider, { input: generation.tokensIn, output: generation.tokensOut });
}

const HEX32 = /^[0-9a-f]{32}$/;

/** OpenTelemetry wants a 32-hex trace id: our trace ids are UUIDs, so it is the same id without
 * the dashes (an Ops trace and its Langfuse trace match). Null when the id is not a UUID. */
export function otelTraceId(id: string): string | null {
  const hex = id.replace(/-/g, '').toLowerCase();
  return HEX32.test(hex) ? hex : null;
}

function nanos(at: Date): string {
  return `${at.getTime()}000000`;
}

type OtelAttribute = { readonly key: string; readonly value: { readonly stringValue: string } };

function attributes(values: Record<string, string | null>): OtelAttribute[] {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function usageDetails(generation: Generation): string | null {
  if (generation.tokensIn === null || generation.tokensOut === null) return null;
  return JSON.stringify({ input: generation.tokensIn, output: generation.tokensOut });
}

/** Langfuse's own attribute names (OpenTelemetry docs, read 2026-11-23). */
function spanAttributes(
  settings: LangfuseSettings,
  generation: Generation,
  opsTraceId: string,
): OtelAttribute[] {
  const { input, output } = shown(settings, generation);
  const cost = costInr(generation);
  return attributes({
    'langfuse.trace.name': generation.name,
    'langfuse.trace.metadata.ops_trace_id': opsTraceId,
    'langfuse.observation.type': 'generation',
    'langfuse.observation.model.name': generation.model,
    'langfuse.observation.input': JSON.stringify(input),
    'langfuse.observation.output': output,
    'langfuse.observation.usage_details': usageDetails(generation),
    'langfuse.observation.level': generation.error ? 'ERROR' : 'DEFAULT',
    'langfuse.observation.status_message': generation.error,
    'langfuse.observation.metadata.provider': generation.provider,
    'langfuse.observation.metadata.prompt_version': generation.promptVersion,
    'langfuse.observation.metadata.cost_inr': cost === null ? null : cost.toFixed(6),
    'langfuse.observation.metadata.redacted': String(settings.redact),
    'langfuse.version': generation.promptVersion,
  });
}

/** One call as one OpenTelemetry span (OTLP/HTTP JSON), which Langfuse shows as a trace with one
 * generation. `traceId` is ours (a UUID); `spanId` any fresh UUID (its first 16 hex digits). */
export function otlpPayload(
  settings: LangfuseSettings,
  generation: Generation,
  ids: { readonly traceId: string; readonly spanId: string },
): Record<string, unknown> {
  const span = {
    traceId: otelTraceId(ids.traceId),
    spanId: ids.spanId.replace(/-/g, '').slice(0, 16),
    name: generation.name,
    kind: 3,
    startTimeUnixNano: nanos(generation.startedAt),
    endTimeUnixNano: nanos(generation.endedAt),
    attributes: spanAttributes(settings, generation, ids.traceId),
    status: generation.error ? { code: 2, message: generation.error } : { code: 1 },
  };
  return {
    resourceSpans: [{
      resource: { attributes: attributes({ 'service.name': 'easy-recovery-ai' }) },
      scopeSpans: [{ scope: { name: 'easy-recovery-ai/json-llm' }, spans: [span] }],
    }],
  };
}

async function send(
  settings: LangfuseSettings,
  deps: LangfuseDeps,
  batch: Record<string, unknown>,
): Promise<void> {
  try {
    const auth = btoa(`${settings.publicKey}:${settings.secretKey}`);
    const response = await deps.fetchImpl(`${settings.host}${OTLP_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        // Without it Langfuse shows directly sent spans up to 10 minutes late.
        'x-langfuse-ingestion-version': '4',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(LANGFUSE_TIMEOUT_MS),
    });
    if (!response.ok) deps.log('warn', 'langfuse_send_failed', { status: response.status });
  } catch (error) {
    deps.log('warn', 'langfuse_send_failed', { error: errorName(error) });
  }
}

/** The observer for json-llm.ts, or undefined when tracing is off. */
export function createLangfuseObserver(
  env: LangfuseEnv,
  deps: LangfuseDeps,
): LlmObserver | undefined {
  const settings = langfuseSettings(env);
  if (!settings) return undefined;
  return function observe(generation): void {
    try {
      const ours = deps.traceId();
      const traceId = ours && otelTraceId(ours) ? ours : deps.newId();
      const batch = otlpPayload(settings, generation, { traceId, spanId: deps.newId() });
      deps.defer(send(settings, deps, batch));
    } catch (error) {
      deps.log('warn', 'langfuse_send_failed', { error: errorName(error) });
    }
  };
}
