// web/src/lib/healthSchemas.ts
// Shape of the Agent health reply (Saim, 2026-11-20): Asha's and Munshi's health across their
// recent calls (calls-api/agent-health-routes.ts). Checked with Zod like every other reply.
import { z } from 'zod';

const VerdictCountsSchema = z.object({
  good: z.number(),
  check: z.number(),
  failed: z.number(),
});

export const AgentHealthSchema = z.object({
  agent: z.enum(['asha', 'munshi', 'whatsapp']),
  calls: z.number(),
  verdicts: VerdictCountsSchema,
  /** Which calls had each verdict (2026-11-22); the page links to exactly those calls. */
  verdictCallIds: z
    .object({ good: z.array(z.string()), check: z.array(z.string()), failed: z.array(z.string()) })
    .default({ good: [], check: [], failed: [] }),
  problems: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      group: z.string(),
      fails: z.number(),
      warns: z.number(),
      callIds: z.array(z.string()),
    }),
  ),
  guardrailFails: z.number(),
  replyP50Ms: z.number().nullable(),
  averageCostInr: z.number().nullable(),
  tone: z.array(
    z.object({ id: z.string(), label: z.string(), average: z.number(), calls: z.number() }),
  ),
  versions: z.array(
    VerdictCountsSchema.extend({ version: z.number().nullable(), calls: z.number() }),
  ),
  trend: z.array(VerdictCountsSchema.extend({ date: z.string() })),
});

export const HealthSummarySchema = z.object({
  today: z.string(),
  /** Finished calls not scored yet; they are scored a few per page load. */
  waiting: z.number(),
  agents: z.array(AgentHealthSchema),
});

export type AgentHealth = z.infer<typeof AgentHealthSchema>;
export type HealthSummary = z.infer<typeof HealthSummarySchema>;
