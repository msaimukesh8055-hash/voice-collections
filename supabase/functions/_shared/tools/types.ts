// supabase/functions/_shared/tools/types.ts
// Tool contract. Every reply carries `say`: a short, ready-to-use line for Asha (Sarvam feeds it
// to the LLM through the tool's response template, "{{say}}"). Refusals never contain amounts.
import type { CallSession, Repository } from '../db/repository.ts';

export interface ToolContext {
  readonly repo: Repository;
  readonly session: CallSession;
  /** Demo-aware "now" (demo clock when set). */
  readonly now: Date;
}

export const TOOL_ERRORS = {
  IDENTITY_NOT_CONFIRMED:
    'Identity is not confirmed yet. Share no amounts or dates. Ask once whether you are ' +
    'speaking with the shopkeeper of this shop, then call confirm_identity with the answer.',
  IDENTITY_DENIED:
    'This person is not the shopkeeper. Share nothing about dues or amounts. Apologise, say ' +
    'you will call another time, and end the call politely.',
  POLICY_REFUSED: 'This request is outside the rules.',
  INVALID_ARGS: 'The tool arguments were invalid.',
  UNKNOWN_TOOL: 'This tool does not exist. Carry on without it.',
  CALL_NOT_AUTHORISED:
    'This call is not authorised. Share no details; apologise and end the call politely.',
  TEMPORARY_ERROR:
    'Something went wrong on our side. Share no figures; apologise and say the owner will ' +
    'call them back.',
} as const satisfies Record<string, string>;

export type ToolErrorCode = keyof typeof TOOL_ERRORS;

export type ToolData = Readonly<Record<string, string | number | boolean | null>>;

export type ToolResult =
  | { readonly ok: true; readonly say: string; readonly data: ToolData }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly say: string };

/** A tool's result plus the updated session when the tool changed it. */
export interface ToolOutcome {
  readonly result: ToolResult;
  readonly session?: CallSession;
}

export function ok(say: string, data: ToolData = {}): ToolOutcome {
  return { result: { ok: true, say, data } };
}

/** `detail` replaces the default text when the reason is specific (e.g. a policy reason). */
export function fail(code: ToolErrorCode, detail?: string): ToolOutcome {
  return { result: { ok: false, code, say: detail ?? TOOL_ERRORS[code] } };
}

/** The flat JSON body Sarvam receives: `{ ok, say, ...data }` or `{ ok: false, code, say }`. */
export function toReplyBody(result: ToolResult): Record<string, unknown> {
  if (!result.ok) return { ok: false, code: result.code, say: result.say };
  return { ...result.data, ok: true, say: result.say };
}
