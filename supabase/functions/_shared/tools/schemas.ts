// supabase/functions/_shared/tools/schemas.ts
// Single source of truth for Asha's tools: name, description (what the LLM reads) and argument
// schema. sarvam-tools validates with these; voice-agents/asha turns them into Sarvam tool
// definitions, so what the LLM is told and what the server accepts cannot drift apart.
// No shopkeeper identifiers here on purpose: the shopkeeper always comes from the call token.
import { z } from 'zod';
import { PAYMENT_MODES } from '../schemas/ledger.ts';

export const IDENTITY_ANSWERS = ['confirmed', 'denied', 'unsure'] as const;
export const CALLBACK_REASONS = ['dispute', 'hardship', 'wants_owner', 'other'] as const;
const MAX_SUMMARY_LENGTH = 300;

const IsoDate = z.iso.date();
/** The LLM may send a number as text ("3000"); anything that is not a positive number fails. */
const Rupees = z.coerce.number().positive();

export const TOOL_SPECS = {
  confirm_identity: {
    description:
      'Record the answer to "Am I speaking with <shopkeeper> of <shop>?". Call it once, as soon ' +
      'as they answer, before sharing anything about dues. Never ask again once confirmed.',
    args: z.object({
      answer: z
        .enum(IDENTITY_ANSWERS)
        .describe(
          'confirmed = they said yes, it is them; denied = someone else (e.g. son, worker); ' +
            'unsure = unclear answer',
        ),
    }),
  },
  get_dues: {
    description:
      'Get what the shopkeeper owes: total outstanding, overdue amount, oldest due date, days ' +
      'overdue and the next amount due, plus what happened before (last promise, last call ' +
      'note, a payment the owner did not receive) and the tone level to use. Only works after ' +
      'confirm_identity. Say the figures once.',
    args: z.object({}),
  },
  log_promise: {
    description:
      'Save the promise once the shopkeeper agrees an amount and a date to pay. Part payments ' +
      'are fine. If they change the amount or date, call it again: it updates the promise ' +
      'for this call.',
    args: z.object({
      amount: Rupees.describe('Promised amount in rupees, e.g. 3000'),
      promise_date: IsoDate.describe('Date they will pay, as YYYY-MM-DD'),
    }),
  },
  record_payment_claim: {
    description:
      'Record that the shopkeeper says they already paid, for the owner to confirm. It does ' +
      'not change the balance. Ask amount, date and mode first. Once per call.',
    args: z.object({
      amount: Rupees.describe('Amount they say they paid, in rupees'),
      paid_date: IsoDate.describe('Date they say they paid, as YYYY-MM-DD'),
      mode: z.enum(PAYMENT_MODES).describe('How they paid: cash, upi, bank_transfer or cheque'),
    }),
  },
  request_owner_callback: {
    description:
      'Ask the owner to call the shopkeeper back: when they dispute the amount, mention ' +
      'hardship, or want to talk to the owner. Works before identity is confirmed.',
    args: z.object({
      reason: z.enum(CALLBACK_REASONS).describe('dispute, hardship, wants_owner or other'),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(MAX_SUMMARY_LENGTH)
        .describe('One sentence for the owner, in English'),
    }),
  },
} as const;

export type ToolName = keyof typeof TOOL_SPECS;
export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOL_SPECS)[N]['args']>;
export const TOOL_NAMES = Object.keys(TOOL_SPECS) as readonly ToolName[];
