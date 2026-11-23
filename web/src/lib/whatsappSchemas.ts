// web/src/lib/whatsappSchemas.ts
// Shape of the WhatsApp live-checks replies (Saim, 2026-11-22; ADR-0022): the owner's latest
// WhatsApp exchanges with each one's verdict, and one exchange with its full scorecard
// (calls-api/whatsapp-routes.ts). Checked with Zod like every other reply.
import { z } from 'zod';
import { TraceStepSchema } from './opsSchemas.ts';
import { ScorecardSchema } from './scorecardSchemas.ts';

const VerdictSchema = z.enum(['good', 'check', 'failed']);

export const ExchangeListItemSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  msgType: z.string(),
  path: z.string(),
  command: z.string().nullable(),
  inText: z.string().nullable(),
  isTest: z.boolean(),
  handleMs: z.number(),
  verdict: VerdictSchema,
  passed: z.number(),
  applicable: z.number(),
  /** Check ids behind "Needs a look" / "Failed"; empty when it went well. */
  reasons: z.array(z.string()).default([]),
});
export const ExchangeListSchema = z.object({ exchanges: z.array(ExchangeListItemSchema) });

export const ExchangeDetailSchema = z.object({
  exchange: z.object({
    id: z.string(),
    createdAt: z.string(),
    msgType: z.string(),
    path: z.string(),
    command: z.string().nullable(),
    inText: z.string().nullable(),
    replyText: z.string().nullable(),
    language: z.string().nullable(),
    voiceReply: z.boolean(),
    handleMs: z.number(),
    isTest: z.boolean(),
  }),
  scorecard: ScorecardSchema,
  /** Readable traces (2026-11-23): this message's steps; empty for older messages. */
  trace: z.array(TraceStepSchema).default([]),
});

export type ExchangeListItem = z.infer<typeof ExchangeListItemSchema>;
export type ExchangeDetail = z.infer<typeof ExchangeDetailSchema>;
