// web/src/lib/opsSchemas.ts
// Shapes of the ops page's two replies (M9 Build A): the summary and one trace. Checked with Zod
// like every other dashboard reply.
import { z } from 'zod';

const RequestCountSchema = z.object({ requests: z.number(), failed: z.number() });
const SpendSchema = z.object({ voiceInr: z.number(), llmInr: z.number(), totalInr: z.number() });
const VoiceUseSchema = z.object({ liveMinutes: z.number(), simulatedCalls: z.number() });
const TokenCountSchema = z.object({ input: z.number(), output: z.number() });

export const OpsSummarySchema = z.object({
  day: RequestCountSchema,
  week: RequestCountSchema,
  sources: z.array(RequestCountSchema.extend({ source: z.string(), p95Ms: z.number().nullable() })),
  tools: z.array(
    z.object({
      agent: z.enum(['asha', 'munshi']),
      tool: z.string(),
      calls: z.number(),
      p50Ms: z.number(),
      p95Ms: z.number(),
    }),
  ),
  llm: z.array(
    z.object({
      provider: z.string(),
      answers: z.number(),
      rejected: z.number(),
      failed: z.number(),
    }),
  ),
  tokens: z.array(
    z.object({ provider: z.string(), today: TokenCountSchema, month: TokenCountSchema }),
  ),
  paths: z.record(z.string(), z.number()),
  followups: z.object({ waiting: z.number(), stuck: z.number(), failedWeek: z.number() }),
  voice: z.object({ today: VoiceUseSchema, month: VoiceUseSchema }),
  recentErrors: z.array(
    z.object({
      traceId: z.string(),
      source: z.string(),
      step: z.string(),
      errorCode: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  toolTargetMs: z.number(),
  spend: z.object({ capInr: z.number(), today: SpendSchema, month: SpendSchema }),
  generatedAt: z.string(),
});

export const TraceSchema = z.object({
  traceId: z.string(),
  steps: z.array(
    z.object({
      source: z.string(),
      step: z.string(),
      status: z.enum(['ok', 'warn', 'error']),
      errorCode: z.string().nullable(),
      provider: z.string().nullable(),
      durationMs: z.number().nullable(),
      tokensIn: z.number().nullable(),
      tokensOut: z.number().nullable(),
      detail: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
    }),
  ),
});

export type OpsSummary = z.infer<typeof OpsSummarySchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type TraceStep = Trace['steps'][number];
