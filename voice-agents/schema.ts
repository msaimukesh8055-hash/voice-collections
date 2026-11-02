// voice-agents/schema.ts
// Shape of an agent configuration. Validated before anything is pushed to Vapi.
import { z } from 'zod';

/** Spike/demo budget guard: no single call may run longer than this. */
export const MAX_CALL_SECONDS = 300;

/**
 * Live-voice models, hosted by Vapi (ADR-0007). Gemini's free tier was too slow/unavailable
 * for real-time replies; Gemini stays the model for evals, follow-ups and summaries.
 */
export const VOICE_MODELS = ['gpt-4.1-mini', 'gpt-4.1-nano'] as const;

const NonEmptyText = z.string().trim().min(1);

const TranscriberSchema = z.object({
  provider: z.literal('deepgram'),
  model: NonEmptyText,
  language: NonEmptyText,
});

const VoiceSchema = z.object({ provider: z.literal('azure'), voiceId: NonEmptyText });

export const VariantSchema = z.object({
  language: z.enum(['en', 'hi']),
  label: NonEmptyText,
  transcriber: TranscriberSchema,
  voice: VoiceSchema,
  firstMessage: NonEmptyText,
  idleMessage: NonEmptyText,
  endCallMessage: NonEmptyText,
  /** Wait after the caller stops (no punctuation in the transcript) before replying. Vapi allows 0–3 s. */
  endOfSpeechWaitSeconds: z.number().min(0).max(3),
  /** Language-specific text the system prompt pulls in as {{name}}, filled when a call starts. */
  promptVariables: z.record(z.string().regex(/^[a-zA-Z]+$/), NonEmptyText),
});

/** A server-side tool in Vapi's format; parameters are JSON Schema generated from Zod. */
export const FunctionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().regex(/^[a-z_]+$/),
    description: NonEmptyText,
    parameters: z.record(z.string(), z.unknown()),
  }),
});

export const AgentConfigSchema = z.object({
  name: NonEmptyText,
  model: z.object({ provider: z.literal('openai'), model: z.enum(VOICE_MODELS) }),
  systemPrompt: NonEmptyText,
  tools: z.array(FunctionToolSchema).readonly(),
  variants: z.strictObject({
    en: VariantSchema,
    hi: VariantSchema,
  }),
  defaultVariant: z.enum(['en', 'hi']),
  interruption: z.object({
    numWords: z.number().int().nonnegative(),
    voiceSeconds: z.number().positive(),
    backoffSeconds: z.number().positive(),
  }),
  idleTimeoutSeconds: z.number().positive(),
  maxDurationSeconds: z.number().int().positive().max(MAX_CALL_SECONDS),
});

export type Variant = z.infer<typeof VariantSchema>;
export type FunctionTool = z.infer<typeof FunctionToolSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
