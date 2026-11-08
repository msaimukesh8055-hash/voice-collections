// supabase/functions/_shared/simulator/munshi-text.ts
// Munshi in a text eval (M8 C1): the approved Munshi prompt (v1), unchanged and with the same
// agent variables the /munshi page sends, plus a short text-mode section that says how to call a
// tool in text (Sarvam's voice platform does this for him on live calls). Same shape as Asha's
// (asha-text.ts). Munshi's prompt is imported, never copied, so the live agent and the evals
// cannot drift apart. Tools are declared to sarvam-105b natively, from the same Zod schemas
// munshi-tools validates with.
// ⚠️ The text-mode section is prompt text (Saim's decision): written to the plan's description
// ("OWNER: …" / "TOOL REPLY <name>: {…}", one JSON move, one tool per answer, end_call with the
// goodbye), worded like Asha's approved text-mode v1.
import { z } from 'zod';
import { renderMunshiGreeting } from '../../../../voice-agents/munshi/greetings.ts';
import { MUNSHI_PROMPT, PROMPT_VERSION } from '../../../../voice-agents/munshi/prompt.ts';
import type { ChatTool } from '../llm/json-llm.ts';
import { OWNER_TOOL_NAMES, OWNER_TOOL_SPECS } from '../owner-tools/schemas.ts';

export const MUNSHI_TEXT_MODE_VERSION = 'v1';
/** Recorded with each eval run, so results can tell prompt versions apart. */
export const MUNSHI_SIMULATED_VERSION = `${PROMPT_VERSION}+text-${MUNSHI_TEXT_MODE_VERSION}`;
/** How the owner's lines reach Munshi in text: "OWNER: ...". */
export const OWNER_LABEL = 'OWNER';

export interface MunshiVariables {
  /** "Srinivas" */
  readonly ownerShortName: string;
  /** "Srinivas Reddy" */
  readonly ownerName: string;
  readonly businessName: string;
  /** e.g. "Saturday, 2026-11-07" (istDayLabel on the demo clock), as on live calls. */
  readonly today: string;
}

/** Munshi's 10 tools as declared to sarvam-105b, which calls them natively (see json-llm). */
export function munshiTools(): readonly ChatTool[] {
  return OWNER_TOOL_NAMES.map((name) => ({
    name,
    description: OWNER_TOOL_SPECS[name].description,
    parameters: z.toJSONSchema(OWNER_TOOL_SPECS[name].args),
  }));
}

function toolList(): string {
  return OWNER_TOOL_NAMES.map((name) => {
    const spec = OWNER_TOOL_SPECS[name];
    const args = JSON.stringify(z.toJSONSchema(spec.args).properties ?? {});
    return `- ${name}: ${spec.description} Arguments: ${args}`;
  }).join('\n');
}

const TEXT_MODE = `

# Text simulation
This call happens in text: there is no audio. Each message you get is either his words ("${OWNER_LABEL}: ...") or a tool reply ("TOOL REPLY <name>: {...}").
Answer every message with one JSON object only:
{"say": "what you say aloud, or an empty string", "tool": null or {"name": "<tool name>", "args": {...}}, "end_call": false}
- "call tool:<name>" in your instructions means: set "tool". You get the tool's reply next, then answer again.
- One tool per answer. Use the argument names below exactly.
- Set "end_call" to true together with your goodbye.
Tools:
`;

/** {{name}} → its value; a name with no value stays as written (visible, never blank). */
export function fillAgentVariables(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, function fill(match: string, name: string): string {
    return values[name] ?? match;
  });
}

export function munshiSystemPrompt(variables: MunshiVariables): string {
  const filled = fillAgentVariables(MUNSHI_PROMPT, {
    owner_short_name: variables.ownerShortName,
    owner_name: variables.ownerName,
    business_name: variables.businessName,
    today: variables.today,
  });
  return `${filled}${TEXT_MODE}${toolList()}`;
}

/** Munshi's first line (always Telugu), exactly as the /munshi page sends it. */
export function munshiGreeting(variables: MunshiVariables): string {
  return renderMunshiGreeting(variables.ownerShortName);
}
