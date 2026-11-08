// supabase/functions/_shared/owner-tools/registry.ts
// Munshi's typed name → tool map (M8 A4; Build B adds the six prepare tools, confirm and cancel), on the same validate → run → catch wrapper as Asha's
// (tools/registry.ts, defineToolWith), with the owner context and Munshi's own refusal lines.
// Asha's tool names do not exist here, and Munshi's do not exist in Asha's registry: a request
// for the other agent's tool gets UNKNOWN_TOOL.
import {
  AUDIT_MARKERS,
  defineToolWith,
  type RegisteredTool,
  type ToolRun,
} from '../tools/define.ts';
import { bookSummary } from './book-summary.ts';
import { cancelAction } from './cancel-action.ts';
import { confirmAction } from './confirm-action.ts';
import { lookupShopkeeper } from './lookup-shopkeeper.ts';
import { prepareClaim } from './prepare-claim.ts';
import { prepareCredit } from './prepare-credit.ts';
import { prepareDelete } from './prepare-delete.ts';
import { preparePayment } from './prepare-payment.ts';
import { prepareRemind } from './prepare-remind.ts';
import { prepareSend } from './prepare-send.ts';
import { OWNER_TOOL_SPECS, type OwnerToolName } from './schemas.ts';
import { ownerFail, type OwnerToolContext, type OwnerToolErrorCode } from './types.ts';

export type OwnerToolRun = ToolRun<OwnerToolErrorCode>;

const defineOwnerTool = defineToolWith<OwnerToolContext, OwnerToolErrorCode>({
  invalidArgs: (detail) => ownerFail('INVALID_ARGS', detail),
  temporaryError: () => ownerFail('TEMPORARY_ERROR'),
});

const OWNER_TOOLS: Readonly<
  Record<OwnerToolName, RegisteredTool<OwnerToolContext, OwnerToolErrorCode>>
> = {
  book_summary: defineOwnerTool(OWNER_TOOL_SPECS.book_summary.args, bookSummary),
  lookup_shopkeeper: defineOwnerTool(OWNER_TOOL_SPECS.lookup_shopkeeper.args, lookupShopkeeper),
  prepare_credit: defineOwnerTool(OWNER_TOOL_SPECS.prepare_credit.args, prepareCredit),
  prepare_payment: defineOwnerTool(OWNER_TOOL_SPECS.prepare_payment.args, preparePayment),
  prepare_delete: defineOwnerTool(OWNER_TOOL_SPECS.prepare_delete.args, prepareDelete),
  prepare_remind: defineOwnerTool(OWNER_TOOL_SPECS.prepare_remind.args, prepareRemind),
  prepare_claim: defineOwnerTool(OWNER_TOOL_SPECS.prepare_claim.args, prepareClaim),
  prepare_send: defineOwnerTool(OWNER_TOOL_SPECS.prepare_send.args, prepareSend),
  confirm_action: defineOwnerTool(OWNER_TOOL_SPECS.confirm_action.args, confirmAction),
  cancel_action: defineOwnerTool(OWNER_TOOL_SPECS.cancel_action.args, cancelAction),
};

export function isOwnerToolName(name: string): name is OwnerToolName {
  return Object.hasOwn(OWNER_TOOLS, name);
}

export function runOwnerTool(
  name: string,
  rawArgs: unknown,
  ctx: OwnerToolContext,
): Promise<OwnerToolRun> {
  if (!isOwnerToolName(name)) {
    return Promise.resolve({ ...ownerFail('UNKNOWN_TOOL'), auditArgs: AUDIT_MARKERS.unknownTool });
  }
  return OWNER_TOOLS[name].run(ctx, rawArgs);
}
