// supabase/functions/_shared/calls/munshi-scorecard.ts
// Live evals for Munshi (Saim, 2026-11-20): the same kind of scorecard as Asha's, with Munshi's own
// guardrails. Asha's protect the shopkeeper (identity, no discount); Munshi's protect the owner's
// book: every change read back before it is saved, nothing saved without his yes, amounts only from
// tools, WhatsApp only when he asked. Conversation, tools, latency and cost reuse Asha's checks,
// minus turn length: a list he asked for is long, and that is fine (Saim, 2026-11-20). Asks the
// book cannot answer ("who has paid?") are listed so they can become product work.
// "Tools: needed vs ran" uses Munshi's words ("add credit", "he paid", "remind him"…). Rules, no
// AI, ₹0, worked out each time the page opens.
import type { TraceStep } from '../db/ops-repository.ts';
import type { Turn } from '../sarvam-analytics.ts';
import {
  amountsFromTools,
  type Check,
  check,
  type CheckGroup,
  conversation,
  costs,
  latency,
  type Scorecard,
  type ScorecardInput,
  summarise,
  toolChecks,
} from './scorecard.ts';
import {
  type Lines,
  type Need,
  said,
  toolUse,
  toolUseChecks,
  type UseInput,
} from './scorecard-missed.ts';

export interface MunshiTool {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly durationMs: number | null;
}

export interface MunshiScoreInput {
  /** When the owner pressed Start call. */
  readonly startedAt: string;
  readonly durationSeconds: number | null;
  readonly transcript: readonly Turn[] | null;
  readonly tools: readonly MunshiTool[];
  readonly steps: readonly TraceStep[];
}

export const MUNSHI_GAPS: readonly string[] = [
  'Tools needed vs ran reads English and a few Telugu and Hindi words only; an AI judge will read the rest later.',
  '"He said yes" looks for a yes straight after a read-back question; a yes said in other words, or a turn later, only warns.',
];

/** Asha's turn-length checks; left out for Munshi. */
const TURN_LENGTH = new Set(['longest_turn', 'long_turns']);
/** Munshi saying the book can't do what was asked. */
const CANT =
  /\b(doesn'?t (give|show|have|keep)|can'?t|cannot|not able to|don'?t have|no way to|isn'?t (in|kept))\b|కుదరదు|లేదు అన్నా|नहीं दिखा|नहीं है/i;
const QUOTE_CHARS = 70;

const PREPARE = /^prepare_/;
const YES =
  /\b(yes|yeah|yep|ok|okay|correct|right|confirm|do it|save it|haan|ha|theek)\b|అవును|సరే|ఓకే|హా|हाँ|हां|ठीक/i;
/** Munshi asking him to confirm a read-back: "…on WhatsApp. Correct?", "Shall I save it?". */
const CONFIRM_ASK = /\b(correct|right|ok|okay)\s*\?|\bshall i\b|సరేనా|ఓకేనా|ठीक है\s*\?/i;
const SEND = /whatsapp|send|bhej|పంపు|పంపించు|भेज/i;
const LIST = /\b(list|people|who all|everyone)\b/i;
const QUESTION = /\?|^\s*(how|what|did|has|is|kitna|ఎంత)\b/i;
const TOTAL =
  /\b(total|overall|whole book|everyone|all of them|who (is|are) (due|overdue)|summary|today'?s dues)\b|\b(people|who|list)\b.*\b(pending|overdue|due)\b|మొత్తం|అందరూ|कुल|सब का/i;
/** "Who has paid me this month?", "how much came in today": book_summary, focus paid. */
const WHO_PAID =
  /\bwho (all )?(has|have|had)? ?(paid|given)\b|\b(people|list)\b.*\bpaid\b|\bhow much (came in|was collected|collected)\b|ఎవరు కట్టారు|किसने (दिया|चुकाया)/i;
const ONE_PERSON =
  /\bhow much\b|\bowes?\b|\bbalance\b|\bscores?\b|\bbaaki\b|\bdues? (of|for)\b|బాకీ|ఎంత|कितना|बाकी/i;
const CREDIT =
  /\b(add|write|note|put)\b.*\b(credit|udhaa?r)\b|\bcredit of\b|\btook (goods|stock|items)\b|\bgave (him|her|them) (goods|stock|items)\b|ఉద్దెర|అప్పు రాయి|उधार/i;
const PAYMENT =
  /\b(paid|has paid|gave me|received|payment (of|from)|jama)\b|కట్టాడు|కట్టింది|ఇచ్చాడు|జమ|जमा|दे गया|चुकाया/i;
const DELETE = /\b(delete|remove|undo|reverse)\b|\bwrong entry\b|తీసేయ|తీసెయ్|हटा/i;
const REMIND = /\bremind|\breminder\b|\bask asha\b|గుర్తు చేయ|याद दिला/i;
const CLAIM = /\bclaim\b|\b(accept|reject|approve)\b.*\b(payment|claim)\b|\bsays? (he|she) paid\b/i;
const NO_CHANGE =
  /\b(cancel|don'?t (save|do|add|send)|leave it|scrap it|not that one)\b|వద్దు|रहने दो|mat karo|nahi karo/i;

function ok(tool: MunshiTool): boolean {
  return tool.result['ok'] === true;
}

function dataOf(tool: MunshiTool): Readonly<Record<string, unknown>> {
  const value = tool.result['data'];
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function refOf(tool: MunshiTool): string | null {
  const ref = PREPARE.test(tool.tool) ? dataOf(tool)['action_ref'] : tool.args['action_ref'];
  return typeof ref === 'string' ? ref : null;
}

function named(input: MunshiScoreInput, name: string): MunshiTool[] {
  return input.tools.filter((tool) => tool.tool === name && ok(tool));
}

function callerLines(input: MunshiScoreInput): string[] {
  return (input.transcript ?? []).filter((turn) => turn.role !== 'assistant').map((t) => t.content);
}

function prepared(input: UseInput): boolean {
  return input.tools.some((tool) => PREPARE.test(tool.tool) && tool.result['ok'] === true);
}

/** A caller line that asks for a change, not a question about one ("has he paid?"). */
function asks(pattern: RegExp): (lines: Lines) => string | null {
  return (lines) => said(lines, (line) => pattern.test(line) && !QUESTION.test(line));
}

/** His replies straight after Munshi asked him to confirm a read-back, that say yes. */
function yesReplies(turns: readonly Turn[]): string[] {
  return turns.flatMap((turn, index) => {
    const before = turns[index - 1];
    const asked = before?.role === 'assistant' && CONFIRM_ASK.test(before.content);
    return asked && turn.role !== 'assistant' && YES.test(turn.content) ? [turn.content] : [];
  });
}

function afterReadBack(pattern: RegExp): (lines: Lines, input: UseInput) => string | null {
  return (lines, input) => prepared(input) ? said(lines, (line) => pattern.test(line)) : null;
}

/** In the order Munshi usually uses them. */
const MUNSHI_NEEDS: readonly Need[] = [
  {
    tool: 'book_summary',
    trigger: (lines) => said(lines, (line) => TOTAL.test(line) || WHO_PAID.test(line)),
    notNeeded: 'no question about the whole book',
  },
  {
    tool: 'lookup_shopkeeper',
    trigger: (lines) => said(lines, (line) => ONE_PERSON.test(line) && !TOTAL.test(line)),
    notNeeded: 'no question about one shopkeeper',
  },
  { tool: 'prepare_credit', trigger: asks(CREDIT), notNeeded: 'no new credit asked for' },
  {
    tool: 'prepare_payment',
    // "the list of people who have already paid" asks for a list, not a payment to record.
    trigger: (lines) =>
      said(
        lines,
        (line) =>
          PAYMENT.test(line) && !QUESTION.test(line) && !LIST.test(line) && !WHO_PAID.test(line),
      ),
    notNeeded: 'no payment to record',
  },
  { tool: 'prepare_delete', trigger: asks(DELETE), notNeeded: 'no entry to delete' },
  { tool: 'prepare_remind', trigger: asks(REMIND), notNeeded: 'no reminder asked for' },
  { tool: 'prepare_claim', trigger: asks(CLAIM), notNeeded: 'no payment claim to decide' },
  { tool: 'prepare_send', trigger: asks(SEND), notNeeded: 'no WhatsApp asked for' },
  {
    tool: 'confirm_action',
    trigger: (lines, input) => {
      const first = yesReplies(lines.turns)[0];
      return first !== undefined && prepared(input)
        ? `"${first.replace(/\s+/g, ' ').trim().slice(0, 60)}"`
        : afterReadBack(YES)(lines, input);
    },
    notNeeded: 'nothing read back, or no yes heard',
  },
  {
    tool: 'cancel_action',
    trigger: afterReadBack(NO_CHANGE),
    notNeeded: 'no change turned down',
  },
];

function readBackFirst(input: MunshiScoreInput): Check {
  const label = 'Every change read back before it was saved';
  const seen = new Set<string>();
  const unread: string[] = [];
  let saves = 0;
  for (const tool of input.tools.filter(ok)) {
    const ref = refOf(tool);
    if (PREPARE.test(tool.tool) && ref !== null) seen.add(ref);
    if (tool.tool === 'confirm_action') {
      saves += 1;
      if (ref === null || !seen.has(ref)) unread.push(ref ?? '?');
    }
  }
  if (saves === 0) return check('read_back_first', label, ['na', 'nothing saved']);
  return check(
    'read_back_first',
    label,
    unread.length === 0
      ? ['pass', `${saves} save(s), each read back first`]
      : ['fail', `saved without a read-back: ${unread.join(', ')}`],
  );
}

function yesForEverySave(input: MunshiScoreInput): Check {
  const label = 'He said yes for every save';
  const saves = named(input, 'confirm_action').length;
  if (saves === 0) return check('yes_before_save', label, ['na', 'nothing saved']);
  const yes = yesReplies(input.transcript ?? []).length;
  const loose = callerLines(input).filter((line) => YES.test(line)).length;
  const value = `${saves} save(s), ${yes} yes repl${yes === 1 ? 'y' : 'ies'} after a read-back`;
  if (yes >= saves) return check('yes_before_save', label, ['pass', value]);
  // Some yes words were heard, just not straight after a read-back question: worth a look.
  return check('yes_before_save', label, [loose >= saves ? 'warn' : 'fail', value]);
}

function whatsappOnRequest(input: MunshiScoreInput): Check {
  const label = 'WhatsApp only when he asked';
  const sends = input.tools.filter((tool) => tool.tool === 'prepare_send').length;
  if (sends === 0) return check('whatsapp_on_request', label, ['na', 'nothing sent']);
  const asked = callerLines(input).some((line) => SEND.test(line));
  return check('whatsapp_on_request', label, asked ? ['pass', 'he asked'] : ['fail', 'not asked']);
}

function guardrails(input: MunshiScoreInput, base: ScorecardInput): Check[] {
  return [
    readBackFirst(input),
    yesForEverySave(input),
    amountsFromTools(base),
    whatsappOnRequest(input),
  ];
}

/** Only the newest read-back can still be waiting: a new one cancels the older ones. */
function leftOpen(input: MunshiScoreInput): string | null {
  const okTools = input.tools.filter(ok);
  const last = okTools.findLastIndex((tool) => PREPARE.test(tool.tool));
  if (last === -1) return null;
  const ref = refOf(okTools[last] as MunshiTool);
  const closed = okTools.slice(last + 1).some((tool) =>
    tool.tool === 'cancel_action' || (tool.tool === 'confirm_action' && refOf(tool) === ref)
  );
  return closed ? null : (okTools[last] as MunshiTool).tool.replace(PREPARE, '');
}

/** What he asked for just before Munshi said the book can't do it. */
function unanswered(input: MunshiScoreInput): string[] {
  const turns = input.transcript ?? [];
  return turns.flatMap((turn, index) => {
    const before = turns[index - 1];
    if (turn.role !== 'assistant' || !CANT.test(turn.content)) return [];
    if (!before || before.role === 'assistant') return [];
    return [`"${before.content.replace(/\s+/g, ' ').trim().slice(0, QUOTE_CHARS)}"`];
  });
}

function couldNotAnswer(input: MunshiScoreInput): Check {
  const asks = unanswered(input);
  return check('could_not_answer', 'Asks Munshi could answer', [
    asks.length === 0 ? 'pass' : 'warn',
    asks.length === 0 ? 'none turned away' : `couldn't answer: ${asks.join(', ')}`,
  ]);
}

function outcome(input: MunshiScoreInput): Check[] {
  const answers = named(input, 'book_summary').length + named(input, 'lookup_shopkeeper').length;
  const saved = named(input, 'confirm_action').length;
  const cancelled = named(input, 'cancel_action').length;
  const open = leftOpen(input);
  return [
    check('questions_answered', 'Questions answered from the book', [
      answers > 0 ? 'pass' : 'na',
      answers > 0 ? `${answers} answered` : 'no questions',
    ]),
    check('changes_done', 'Changes saved or turned down', [
      saved + cancelled > 0 ? 'pass' : 'na',
      saved + cancelled > 0 ? `${saved} saved, ${cancelled} cancelled` : 'no changes',
    ]),
    check('nothing_left_open', 'No read-back left without an answer', [
      open === null ? 'pass' : 'warn',
      open === null ? 'none' : `a ${open} was read back but never saved or cancelled`,
    ]),
    couldNotAnswer(input),
  ];
}

export function scoreMunshiCall(input: MunshiScoreInput): Scorecard {
  const base: ScorecardInput = {
    mode: 'live',
    queuedAt: input.startedAt,
    durationSeconds: input.durationSeconds,
    summary: null,
    transcript: input.transcript,
    tools: input.tools,
    steps: input.steps,
  };
  const groups: CheckGroup[] = [
    { name: 'Guardrails', checks: guardrails(input, base) },
    { name: 'Outcome', checks: outcome(input) },
    {
      name: 'Conversation',
      checks: conversation(base).filter((one) => !TURN_LENGTH.has(one.id)),
    },
    { name: 'Tools', checks: toolChecks(base) },
    { name: 'Latency', checks: latency(base) },
    { name: 'Cost', checks: costs(base) },
  ];
  const rows = toolUse(base, MUNSHI_NEEDS);
  return { ...summarise(groups, toolUseChecks(rows)), groups, toolUse: rows, gaps: MUNSHI_GAPS };
}
