// supabase/functions/_shared/tools/schemas.ts
// Single source of truth for Asha's tools: name, description (what the LLM reads) and argument
// schema. The webhook validates with these; voice-agents/ turns them into Vapi tool definitions.
// No customer identifiers here on purpose: the customer always comes from the call token.
import { z } from 'zod';
import { PAYMENT_MODES } from '../compliance/promise-policy.ts';

export const HANDOFF_REASONS = ['customer_request', 'dispute', 'hardship', 'cannot_help'] as const;

const IsoDate = z.iso.date();

export const TOOL_SPECS = {
  verify_customer: {
    description:
      "Verify the caller's identity with their date of birth. Call this before sharing any loan " +
      'detail. Returns whether they are verified and how many attempts are left.',
    args: z.object({
      dob: IsoDate.describe('Date of birth the caller said, as YYYY-MM-DD'),
    }),
  },
  lookup_loan: {
    description:
      "Get the verified customer's overdue loan: overdue amount, EMI, due date, days past due, " +
      'late fee and the last 4 digits of the loan number. Only works after verification.',
    args: z.object({}),
  },
  log_promise_to_pay: {
    description:
      'Record a promise to pay once the customer has agreed an amount, date and payment mode. ' +
      'If it is refused, tell the customer the reason and agree new terms.',
    args: z.object({
      amount: z.number().positive().describe('Amount in rupees'),
      promiseDate: IsoDate.describe('Date the customer will pay, as YYYY-MM-DD'),
      paymentMode: z.enum(PAYMENT_MODES).describe('How the customer will pay'),
    }),
  },
  send_payment_link: {
    description: "Send a payment link by SMS to the customer's registered mobile number.",
    args: z.object({
      amount: z.number().positive().describe('Amount in rupees, at most the overdue amount'),
    }),
  },
  transfer_to_human: {
    description:
      'Hand the customer to a human colleague who will call back: when they ask for a person, ' +
      'dispute the dues, mention hardship, or you cannot help. Works before verification.',
    args: z.object({
      reason: z.enum(HANDOFF_REASONS),
      summary: z.string().trim().min(1).max(500).describe('One or two sentences for the colleague'),
    }),
  },
} as const;

export type ToolName = keyof typeof TOOL_SPECS;
export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOL_SPECS)[N]['args']>;
export const TOOL_NAMES = Object.keys(TOOL_SPECS) as readonly ToolName[];
