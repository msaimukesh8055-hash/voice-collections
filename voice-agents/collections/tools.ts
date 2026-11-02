// voice-agents/collections/tools.ts
// Asha's tools in Vapi's format, generated from the same Zod schemas the webhook validates with,
// so what the LLM is told and what the server accepts cannot drift apart.
import { z } from 'zod';
import { TOOL_NAMES, TOOL_SPECS } from '../../supabase/functions/_shared/tools/schemas.ts';
import type { FunctionTool } from '../schema.ts';

/** JSON Schema without the `$schema` marker, which Vapi does not expect. */
export function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  const entries = Object.entries(z.toJSONSchema(schema));
  return Object.fromEntries(entries.filter(([key]) => key !== '$schema'));
}

export const COLLECTIONS_TOOLS: readonly FunctionTool[] = TOOL_NAMES.map(
  function toFunctionTool(name): FunctionTool {
    return {
      type: 'function',
      function: {
        name,
        description: TOOL_SPECS[name].description,
        parameters: toToolParameters(TOOL_SPECS[name].args),
      },
    };
  },
);
