// supabase/functions/_shared/tools/registry.ts
// Typed name → tool map. Validation happens here once, so every tool gets parsed arguments, and
// the audit trail only ever sees arguments that passed validation, never raw LLM output (CP1 H1).
// M8: the wrapper itself lives in define.ts (shared with Munshi's owner tools); re-exported here
// for the existing imports.
import { AUDIT_MARKERS, defineToolWith, type RegisteredTool, type ToolRun } from './define.ts';
import { confirmIdentity } from './confirm-identity.ts';
import { getDues } from './get-dues.ts';
import { logPromise } from './log-promise.ts';
import { recordPaymentClaim } from './record-payment-claim.ts';
import { requestOwnerCallback } from './request-owner-callback.ts';
import { TOOL_SPECS, type ToolName } from './schemas.ts';
import { fail, type ToolContext, type ToolErrorCode } from './types.ts';

export {
  AUDIT_MARKERS,
  defineToolWith,
  describeFailure,
  type RegisteredTool,
  type ToolDefiner,
  type ToolFailures,
  type ToolRun,
} from './define.ts';

const defineTool = defineToolWith<ToolContext, ToolErrorCode>({
  invalidArgs: (detail) => fail('INVALID_ARGS', detail),
  temporaryError: () => fail('TEMPORARY_ERROR'),
});

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
