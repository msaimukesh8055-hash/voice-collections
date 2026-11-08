// supabase/functions/_shared/owner-tools/schemas.ts
// Munshi's tool arguments (M8), one Zod schema each: munshi-tools validates with them and
// voice-agents/munshi/tools.ts generates the Sarvam tool fields from them, so the two never
// drift. Build A: the two reads. Build B: the six prepare tools, confirm_action and cancel_action.
// Optional fields accept "" or null as "not given" (an LLM may send an empty value for a field it
// was told it may leave out). Amount bounds and past dates are checked in code, so the reply can
// say what was wrong.
// ⚠️ Descriptions are what the LLM reads: drafts for Saim.
import { z } from 'zod';
import { LEDGER_KINDS } from '../schemas/ledger.ts';

/** What book_summary answers about; one tool call per question (Decision 4). */
export const BOOK_FOCUSES = [
  'overview',
  'due',
  'overdue',
  'promises',
  'claims',
  'insights',
] as const;
export type BookFocus = (typeof BOOK_FOCUSES)[number];

/** prepare_claim: did he get the money a shopkeeper told Asha about? */
export const CLAIM_DECISIONS = ['received', 'not_received'] as const;
export type ClaimDecision = (typeof CLAIM_DECISIONS)[number];
/** prepare_send: what goes out on WhatsApp (today's builders). */
export const SEND_WHATS = ['pending', 'due', 'statement', 'insights'] as const;
export type SendWhat = (typeof SEND_WHATS)[number];

const MAX_NAME_LENGTH = 60;
const MAX_REF_LENGTH = 12;

/** Values an LLM sends for a field it left out. */
const BLANKS: ReadonlySet<unknown> = new Set(['', null]);

function blankToUndefined(value: unknown): unknown {
  if (BLANKS.has(value)) return undefined;
  return value;
}

/** May be left out; "" and null count as left out. */
function optional<T extends z.ZodType>(schema: T): z.ZodPreprocess<z.ZodOptional<T>> {
  return z.preprocess(blankToUndefined, schema.optional());
}

const Name = z.string().trim().min(1).max(MAX_NAME_LENGTH).describe(
  'The shopkeeper or shop name as he said it, in English letters',
);
/** Plain digits; the bounds (more than 0, at most 10 lakh) are checked in code. */
const Rupees = z.coerce.number();
const Day = z.iso.date();
const Ref = z.string().trim().min(1).max(MAX_REF_LENGTH);
const ActionRef = Ref.describe('The action_ref from the read-back he said yes to, e.g. r1');
const CancelRef = Ref.describe('The action_ref from the read-back he said no to, e.g. r1');

export const OWNER_TOOL_SPECS = {
  book_summary: {
    description: 'Whole-book answer in one step: pending total, who is due today or overdue, ' +
      'promises, payment claims waiting, insights. Pick the focus that matches his question.',
    args: z.object({
      focus: z.enum(BOOK_FOCUSES).describe(
        'overview (pending, overdue, due today), due (due today), overdue, promises, claims ' +
          '(payments shopkeepers told Asha about) or insights (this month, top defaulters)',
      ),
    }),
  },
  lookup_shopkeeper: {
    description: 'One shopkeeper: dues, last entries, open promise, payment claims, score and ' +
      "what happened on Asha's calls. Unclear names come back as choices.",
    args: z.object({ name: Name }),
  },
  prepare_credit: {
    description: 'Get a new credit (udhaar given) ready to read back. Changes nothing until ' +
      'confirm_action after his yes.',
    args: z.object({
      name: Name,
      amount: Rupees.describe('Credit amount in rupees, plain digits, e.g. 5000'),
      due_date: optional(Day).describe(
        'Due date as YYYY-MM-DD if he said one; leave out for the usual 15 days',
      ),
    }),
  },
  prepare_payment: {
    description: 'Get a payment he received ready to read back (part or full). Changes ' +
      'nothing until confirm_action after his yes.',
    args: z.object({
      name: Name,
      amount: optional(Rupees).describe('Amount paid in rupees, plain digits; leave out if full'),
      full: optional(z.enum(['yes', 'no'])).describe(
        'yes when he says the shopkeeper paid everything he owes',
      ),
    }),
  },
  prepare_delete: {
    description: 'Get one entry ready to delete (it is reversed and kept on record). With ' +
      'nothing but the name, it is his newest entry. Changes nothing until confirm_action.',
    args: z.object({
      name: Name,
      kind: optional(z.enum(LEDGER_KINDS)).describe('credit or payment, if he said which'),
      amount: optional(Rupees).describe('The entry amount in rupees, if he said it'),
      entry_date: optional(Day).describe('The entry date as YYYY-MM-DD, if he said it'),
    }),
  },
  prepare_remind: {
    description: 'Get a reminder call by Asha ready to read back. She calls right after this ' +
      'call ends. Changes nothing until confirm_action after his yes.',
    args: z.object({ name: Name }),
  },
  prepare_claim: {
    description: 'Accept or reject a payment a shopkeeper told Asha about, ready to read back. ' +
      'Changes nothing until confirm_action after his yes.',
    args: z.object({
      name: Name,
      decision: z.enum(CLAIM_DECISIONS).describe(
        'received = he got the money; not_received = he did not',
      ),
      amount: optional(Rupees).describe('The claimed amount, if he has several claims'),
      entry_date: optional(Day).describe('The claimed payment date as YYYY-MM-DD, if several'),
    }),
  },
  prepare_send: {
    description: 'Only when he asks for something on WhatsApp: get it ready to read back. ' +
      'Nothing is sent until confirm_action after his yes.',
    args: z.object({
      what: z.enum(SEND_WHATS).describe(
        "pending (the pending list), due (today's due list), statement (one shopkeeper) or " +
          'insights',
      ),
      name: optional(Name).describe('Whose statement, for what = statement'),
    }),
  },
  confirm_action: {
    description: 'Do the change he just said yes to, after its read-back and his answer. Never ' +
      'straight after a prepare tool.',
    args: z.object({ action_ref: ActionRef }),
  },
  cancel_action: {
    description: 'He said no or is unsure about the read-back: drop the change. Nothing changes.',
    args: z.object({ action_ref: optional(CancelRef) }),
  },
} as const;

export type OwnerToolName = keyof typeof OWNER_TOOL_SPECS;
export const OWNER_TOOL_NAMES = Object.keys(OWNER_TOOL_SPECS) as OwnerToolName[];
export type OwnerToolArgs<N extends OwnerToolName> = z.infer<(typeof OWNER_TOOL_SPECS)[N]['args']>;
