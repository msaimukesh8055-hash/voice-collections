// voice-agents/asha/tools.ts
// Asha's 5 Sarvam API tools, generated from the same Zod schemas sarvam-tools validates with, so
// what the LLM is told and what the server accepts cannot drift apart. Each request body carries
// the call token (an agent variable, never shown to the LLM) plus the fields the LLM decides,
// flat at the top level. Each reply carries a ready-made `say`, so the template is just "{{say}}".
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
import { llmFieldsOf, RESPONSE_TEMPLATE, tokenField } from '../tool-fields.ts';

export { RESPONSE_TEMPLATE };
/** Spoken by Sarvam when our server does not answer in time: no figures, a safe next step. */
export const ON_FAILURE_LINE =
  "Sorry, I can't check that right now. The owner will call you back about it.";

/** LLM-decided body fields, from the tool's argument schema. */
export function llmFields(name: ToolName): BodyField[] {
  return llmFieldsOf(TOOL_SPECS[name].args);
}

function toApiTool(name: ToolName): ApiTool {
  return {
    name,
    description: TOOL_SPECS[name].description,
    method: 'POST',
    path: `/sarvam-tools/${name}`,
    body: [tokenField(CALL_TOKEN_VARIABLE), ...llmFields(name)],
    respTemplate: RESPONSE_TEMPLATE,
    onFailure: ON_FAILURE_LINE,
    timeoutSeconds: TOOL_TIMEOUT_SECONDS,
  };
}

export const ASHA_TOOLS: ApiTool[] = TOOL_NAMES.map(toApiTool);
