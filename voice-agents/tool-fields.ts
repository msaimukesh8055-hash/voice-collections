// voice-agents/tool-fields.ts
// Sarvam tool body fields generated from a server Zod argument schema (Asha's and Munshi's), so
// what the LLM is told and what the tool server accepts cannot drift apart.
import { z } from 'zod';
import type { BodyField } from './schema.ts';

/** Every reply carries a ready-made `say`, so the response template is just "{{say}}". */
export const RESPONSE_TEMPLATE = '{{say}}';

const JsonProperty = z.object({
  type: z.enum(['string', 'number']),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

const JsonObject = z.object({
  properties: z.record(z.string(), JsonProperty).default({}),
  required: z.array(z.string()).default([]),
});

/** LLM-decided body fields, from a tool's argument schema. */
export function llmFieldsOf(args: z.ZodType): BodyField[] {
  const schema = JsonObject.parse(z.toJSONSchema(args));
  return Object.entries(schema.properties).map(([key, property]): BodyField => ({
    key,
    source: 'llm_prompt',
    type: property.type,
    description: property.description ?? key,
    required: schema.required.includes(key),
    ...(property.enum ? { enum: property.enum } : {}),
  }));
}

/** The token field every body starts with: an agent variable the LLM never sees. */
export function tokenField(variable: string): BodyField {
  return { key: variable, source: 'agent_variable', variable };
}
