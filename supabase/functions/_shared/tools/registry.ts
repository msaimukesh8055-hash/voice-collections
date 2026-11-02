// supabase/functions/_shared/tools/registry.ts
// Typed name → tool map. Validation happens here once, so every tool gets parsed arguments, and
// the audit trail only ever sees arguments that passed validation, never raw LLM output (CP1 H1).
import type { z } from 'zod';
import { RepositoryError } from '../db/postgrest.ts';
import { confirmIdentity } from './confirm-identity.ts';
import { getDues } from './get-dues.ts';
import { logPromise } from './log-promise.ts';
import { recordPaymentClaim } from './record-payment-claim.ts';
import { requestOwnerCallback } from './request-owner-callback.ts';
import { TOOL_SPECS, type ToolName } from './schemas.ts';
import { fail, type ToolContext, type ToolOutcome } from './types.ts';

/** Stored in tool_events in place of arguments that cannot be trusted. */
export const AUDIT_MARKERS = {
  invalid: '[invalid]',
  unknownTool: '[unknown tool]',
  /** A refused call's arguments are never validated, so they are not kept. */
  notAuthorised: '[not authorised]',
} as const;

/** A tool's outcome plus what the audit row may store. `failure` is set when the tool threw
 * (e.g. a database timeout): operation and error code only, safe to log. */
export interface ToolRun extends ToolOutcome {
  readonly auditArgs: unknown;
  readonly failure?: string;
}

interface RegisteredTool {
  run(ctx: ToolContext, rawArgs: unknown): Promise<ToolRun>;
}

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.map((issue) =>
    `${issue.path.join('.') || 'arguments'}: ${issue.message}`
  );
  return `Invalid arguments. ${issues.join('; ')}`;
}

/** RepositoryError messages carry only the operation and code; any other error gives just its
 * name, since its message could quote data. */
export function describeFailure(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return error instanceof Error ? error.name : 'unknown error';
}

function defineTool<S extends z.ZodType>(
  schema: S,
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolOutcome>,
): RegisteredTool {
  return {
    async run(ctx, rawArgs): Promise<ToolRun> {
      const parsed = schema.safeParse(rawArgs);
      if (!parsed.success) {
        const invalid = fail('INVALID_ARGS', describeIssues(parsed.error));
        return { ...invalid, auditArgs: AUDIT_MARKERS.invalid };
      }
      const auditArgs = parsed.data;
      try {
        return { ...(await handler(ctx, parsed.data)), auditArgs };
      } catch (error) {
        // The LLM gets a safe instruction instead of a transport error (CP1 H2).
        return { ...fail('TEMPORARY_ERROR'), auditArgs, failure: describeFailure(error) };
      }
    },
  };
}

const TOOLS: Readonly<Record<ToolName, RegisteredTool>> = {
  confirm_identity: defineTool(TOOL_SPECS.confirm_identity.args, confirmIdentity),
  get_dues: defineTool(TOOL_SPECS.get_dues.args, getDues),
  log_promise: defineTool(TOOL_SPECS.log_promise.args, logPromise),
  record_payment_claim: defineTool(TOOL_SPECS.record_payment_claim.args, recordPaymentClaim),
  request_owner_callback: defineTool(TOOL_SPECS.request_owner_callback.args, requestOwnerCallback),
};

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

export function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolRun> {
  if (!isToolName(name)) {
    return Promise.resolve({ ...fail('UNKNOWN_TOOL'), auditArgs: AUDIT_MARKERS.unknownTool });
  }
  return TOOLS[name].run(ctx, rawArgs);
}
