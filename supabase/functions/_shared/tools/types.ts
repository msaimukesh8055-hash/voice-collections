// supabase/functions/_shared/tools/types.ts
// Tool contract. Results are written for the LLM: short, factual, with the next step when refused.
import type { CallSession, Repository } from '../db/repository.ts';

export interface ToolContext {
  readonly repo: Repository;
  readonly session: CallSession;
  /** Demo-aware "now" (demo clock when set). */
  readonly now: Date;
  /** Real time, for limits that must hold whatever the demo clock says (database timestamps
   * are real time too). */
  readonly realNow: Date;
}

export const TOOL_ERRORS = {
  NOT_VERIFIED:
    'Customer is not verified. Ask for their date of birth and call verify_customer first. ' +
    'Do not share any loan details.',
  VERIFY_LOCKED:
    'Verification attempts are used up. Share no loan details; apologise and end the call politely.',
  POLICY_REFUSED: 'This request is outside policy.',
  NOT_FOUND: 'No overdue loan was found for this customer. Offer a callback from a colleague.',
  INVALID_ARGS: 'The tool arguments were invalid.',
  UNKNOWN_TOOL: 'This tool does not exist.',
  CALL_NOT_AUTHORISED:
    'This call is not authorised. Do not share any details; end the call politely.',
  TEMPORARY_ERROR: 'Something went wrong on our side. Share no loan figures; apologise and say ' +
    'a colleague will call them back.',
} as const satisfies Record<string, string>;

export type ToolErrorCode = keyof typeof TOOL_ERRORS;

export type ToolResult =
  | { readonly ok: true; readonly data: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: string };

/** A tool's result plus the updated session when the tool changed it (so later calls in the
 * same webhook request see it, e.g. verify then lookup). */
export interface ToolOutcome {
  readonly result: ToolResult;
  readonly session?: CallSession;
}

export function ok(data: Readonly<Record<string, unknown>>): ToolOutcome {
  return { result: { ok: true, data } };
}

/** `detail` replaces the default message when the reason is specific (e.g. a policy reason). */
export function fail(code: ToolErrorCode, detail?: string): ToolOutcome {
  return { result: { ok: false, code, message: detail ?? TOOL_ERRORS[code] } };
}
