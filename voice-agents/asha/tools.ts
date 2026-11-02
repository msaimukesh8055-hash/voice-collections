// voice-agents/asha/tools.ts
// Asha's 5 Sarvam API tools, generated from the same Zod schemas sarvam-tools validates with, so
// what the LLM is told and what the server accepts cannot drift apart. Each request body carries
// the call token (an agent variable, never shown to the LLM) plus the fields the LLM decides,
// flat at the top level. Each reply carries a ready-made `say`, so the template is just "{{say}}".
import { z } from 'zod';
import {
  CALL_TOKEN_VARIABLE,
  TOOL_TIMEOUT_SECONDS,
} from '../../supabase/functions/_shared/sarvam.ts';
import {
  TOOL_NAMES,
  TOOL_SPECS,
  type ToolName,
} from '../../supabase/functions/_shared/tools/schemas.ts';
import type { ApiTool, BodyField } from '../schema.ts';

export const RESPONSE_TEMPLATE = '{{say}}';
/** Spoken by Sarvam when our server does not answer in time: no figures, a safe next step. */
export const ON_FAILURE_LINE =
  "Sorry, I can't check that right now. The owner will call you back about it.";

const JsonProperty = z.object({
  type: z.enum(['string', 'number']),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

const JsonObject = z.object({
  properties: z.record(z.string(), JsonProperty).default({}),
  required: z.array(z.string()).default([]),
});

/** LLM-decided body fields, from the tool's argument schema. */
export function llmFields(name: ToolName): BodyField[] {
  const schema = JsonObject.parse(z.toJSONSchema(TOOL_SPECS[name].args));
  return Object.entries(schema.properties).map(([key, property]): BodyField => ({
    key,
    source: 'llm_prompt',
    type: property.type,
    description: property.description ?? key,
    required: schema.required.includes(key),
    ...(property.enum ? { enum: property.enum } : {}),
  }));
}

function toApiTool(name: ToolName): ApiTool {
  const token: BodyField = {
    key: CALL_TOKEN_VARIABLE,
    source: 'agent_variable',
    variable: CALL_TOKEN_VARIABLE,
  };
  return {
    name,
    description: TOOL_SPECS[name].description,
    method: 'POST',
    path: `/sarvam-tools/${name}`,
    body: [token, ...llmFields(name)],
    respTemplate: RESPONSE_TEMPLATE,
    onFailure: ON_FAILURE_LINE,
    timeoutSeconds: TOOL_TIMEOUT_SECONDS,
  };
}

export const ASHA_TOOLS: ApiTool[] = TOOL_NAMES.map(toApiTool);
