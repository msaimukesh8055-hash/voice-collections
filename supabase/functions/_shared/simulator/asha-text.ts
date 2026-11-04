// supabase/functions/_shared/simulator/asha-text.ts
// Asha in a simulated call (SPEC §7.7, M5 Decision 6): the approved Asha prompt (v3), unchanged
// and with the same agent variables the phone page sends, plus a short text-mode section that
// says how to call a tool in text (Sarvam's voice platform does this for her on live calls).
// Text-mode section v1, approved by Saim 2026-11-03: the text-mode section below is new prompt text. Asha's own
// prompt is imported, never copied, so live and simulated calls cannot drift apart.
import { z } from 'zod';
import { renderGreeting } from '../../../../voice-agents/asha/greetings.ts';
import { ASHA_PROMPT, PROMPT_VERSION } from '../../../../voice-agents/asha/prompt.ts';
import type { ChatTool } from '../llm/json-llm.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { TOOL_NAMES, TOOL_SPECS } from '../tools/schemas.ts';

export const TEXT_MODE_VERSION = 'v1';
/** Recorded with each simulated call's logs, so evals can tell prompt versions apart. */
export const ASHA_SIMULATED_VERSION = `${PROMPT_VERSION}+text-${TEXT_MODE_VERSION}`;

export interface AshaVariables {
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly ownerName: string;
  readonly businessName: string;
  /** e.g. "Monday, 2026-11-02" (istDayLabel on the demo clock), as on live calls. */
  readonly today: string;
}

function toolList(): string {
  return TOOL_NAMES.map((name) => {
    const spec = TOOL_SPECS[name];
    const args = JSON.stringify(z.toJSONSchema(spec.args).properties ?? {});
    return `- ${name}: ${spec.description} Arguments: ${args}`;
  }).join('\n');
}

/** The same tools declared natively to sarvam-105b, which calls them that way (see json-llm). */
export function ashaTools(): readonly ChatTool[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_SPECS[name].description,
    parameters: z.toJSONSchema(TOOL_SPECS[name].args),
  }));
}

const TEXT_MODE = `

# Text simulation
This call happens in text: there is no audio. Each message you get is either the shopkeeper's words ("SHOPKEEPER: ...") or a tool reply ("TOOL REPLY <name>: {...}").
Answer every message with one JSON object only:
{"say": "what you say aloud, or an empty string", "tool": null or {"name": "<tool name>", "args": {...}}, "end_call": false}
- "call tool:<name>" in your instructions means: set "tool". You get the tool's reply next, then answer again.
- One tool per answer. Use the argument names below exactly.
- Set "end_call" to true together with your goodbye.
Tools:
`;

export function ashaSystemPrompt(variables: AshaVariables): string {
  const values: Readonly<Record<string, string>> = {
    shopkeeper_name: variables.shopkeeperName,
    shop_name: variables.shopName,
    owner_name: variables.ownerName,
    business_name: variables.businessName,
    today: variables.today,
  };
  const filled = ASHA_PROMPT.replace(
    /\{\{(\w+)\}\}/g,
    function fill(match: string, name: string): string {
      return values[name] ?? match;
    },
  );
  return `${filled}${TEXT_MODE}${toolList()}`;
}

/** Asha's first line, exactly as the phone page sends it on a live call. */
export function ashaGreeting(language: Language, variables: AshaVariables): string {
  return renderGreeting(language, {
    shopkeeperName: variables.shopkeeperName,
    shopName: variables.shopName,
    businessName: variables.businessName,
  });
}
