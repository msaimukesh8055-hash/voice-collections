// voice-agents/munshi/tools.ts
// Munshi's Sarvam API tools (M8), generated from the Zod schemas munshi-tools validates with
// (_shared/owner-tools/schemas.ts). Each body starts with the owner call token (an agent
// variable the LLM never sees), then the fields the LLM decides. Build B: all 10 tools (2 reads,
// 6 prepares, confirm_action, cancel_action).
import {
  OWNER_CALL_TOKEN_VARIABLE,
  TOOL_TIMEOUT_SECONDS,
} from '../../supabase/functions/_shared/sarvam.ts';
import {
  OWNER_TOOL_NAMES,
  OWNER_TOOL_SPECS,
  type OwnerToolName,
} from '../../supabase/functions/_shared/owner-tools/schemas.ts';
import type { ApiTool } from '../schema.ts';
import { llmFieldsOf, RESPONSE_TEMPLATE, tokenField } from '../tool-fields.ts';

/** Spoken by Sarvam when our server does not answer in time: no figures, a safe next step. */
export const MUNSHI_ON_FAILURE_LINE =
  "Sorry, I can't open the book right now. Ask me again in a minute.";

function toApiTool(name: OwnerToolName): ApiTool {
  return {
    name,
    description: OWNER_TOOL_SPECS[name].description,
    method: 'POST',
    path: `/munshi-tools/${name}`,
    body: [tokenField(OWNER_CALL_TOKEN_VARIABLE), ...llmFieldsOf(OWNER_TOOL_SPECS[name].args)],
    respTemplate: RESPONSE_TEMPLATE,
    onFailure: MUNSHI_ON_FAILURE_LINE,
    timeoutSeconds: TOOL_TIMEOUT_SECONDS,
  };
}

export const MUNSHI_TOOLS: ApiTool[] = OWNER_TOOL_NAMES.map(toApiTool);
