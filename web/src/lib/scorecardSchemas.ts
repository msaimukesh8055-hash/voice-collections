// web/src/lib/scorecardSchemas.ts
// The call scorecard schema, on its own (2026-11-23): whatsappSchemas.ts needs it and
// dashboardApi.ts imports whatsappSchemas.ts, so keeping it in dashboardApi.ts made a circular
// import. In the built site the WhatsApp report then failed with "Invalid element at key
// 'scorecard': expected a Zod schema" (the schema was still undefined when it was used).
import { z } from 'zod';

/** Live evals (2026-11-20): the call's scorecard, worked out on the server (scorecard.ts). */
export const ScorecardSchema = z.object({
  verdict: z.enum(['good', 'check', 'failed']),
  passed: z.number(),
  applicable: z.number(),
  groups: z.array(
    z.object({
      name: z.string(),
      checks: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          status: z.enum(['pass', 'warn', 'fail', 'na']),
          value: z.string(),
        }),
      ),
    }),
  ),
  /** Tools: needed vs ran (2026-11-20); missing on servers from before that day. */
  toolUse: z
    .array(
      z.object({
        tool: z.string(),
        needed: z.boolean(),
        timesMs: z.array(z.number().nullable()),
        status: z.enum(['pass', 'warn', 'fail', 'na']),
        why: z.string(),
      }),
    )
    .default([]),
  gaps: z.array(z.string()),
});
