// supabase/functions/_shared/tools/registry.ts
// Typed name → tool map. Validation happens here once, so every tool gets parsed arguments.
import type { z } from 'zod';
import { lookupLoan } from './lookup-loan.ts';
import { logPromiseToPay } from './log-promise-to-pay.ts';
import { TOOL_SPECS, type ToolName } from './schemas.ts';
import { sendPaymentLink } from './send-payment-link.ts';
import { transferToHuman } from './transfer-to-human.ts';
import { fail, type ToolContext, type ToolOutcome } from './types.ts';
import { verifyCustomer } from './verify-customer.ts';

interface RegisteredTool {
  run(ctx: ToolContext, rawArgs: unknown): Promise<ToolOutcome>;
}

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.map((issue) =>
    `${issue.path.join('.') || 'arguments'}: ${issue.message}`
  );
  return `Invalid arguments. ${issues.join('; ')}`;
}

function defineTool<S extends z.ZodType>(
  schema: S,
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolOutcome>,
): RegisteredTool {
  return {
    run(ctx, rawArgs): Promise<ToolOutcome> {
      const parsed = schema.safeParse(rawArgs);
      if (!parsed.success) {
        return Promise.resolve(fail('INVALID_ARGS', describeIssues(parsed.error)));
      }
      return handler(ctx, parsed.data);
    },
  };
}

const TOOLS: Readonly<Record<ToolName, RegisteredTool>> = {
  verify_customer: defineTool(TOOL_SPECS.verify_customer.args, verifyCustomer),
  lookup_loan: defineTool(TOOL_SPECS.lookup_loan.args, lookupLoan),
  log_promise_to_pay: defineTool(TOOL_SPECS.log_promise_to_pay.args, logPromiseToPay),
  send_payment_link: defineTool(TOOL_SPECS.send_payment_link.args, sendPaymentLink),
  transfer_to_human: defineTool(TOOL_SPECS.transfer_to_human.args, transferToHuman),
};

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

export function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) return Promise.resolve(fail('UNKNOWN_TOOL'));
  return TOOLS[name].run(ctx, rawArgs);
}
