// supabase/functions/_shared/calls/scorecard-missed.ts
// Live evals (Saim, 2026-11-20): tools Asha should have called but did not. A silent miss is the
// worst live-agent failure: the call sounds fine but nothing is saved. Each check reads what the
// caller said (rules, no AI) and looks for the tool that should follow. Missed → fail, quoting the
// words so a person can judge it; not mentioned → not applicable. Asha's own words count too: if she
// says the owner will call back or reads back a promise, the tool must have run. The word lists are
// English plus a few Telugu and Hindi words; the scorecard lists that as a gap.
import type { Turn } from '../sarvam-analytics.ts';
import { amountsIn } from './scorecard-amounts.ts';
import type { Check, CheckStatus } from './scorecard.ts';

interface MissedInput {
  readonly transcript: readonly Turn[] | null;
  readonly tools: readonly { readonly tool: string }[];
}

interface Expectation {
  readonly id: string;
  readonly label: string;
  readonly tool: string;
  readonly matches: (line: string) => boolean;
  /** What Asha says when she believes this was done, e.g. "will call you back". */
  readonly ashaSays?: (line: string) => boolean;
}

const QUOTE_CHARS = 60;

const PROMISE =
  /\b(will|i'?ll|can|shall)\s+(pay|give|send|clear)\b|\bpay\s+(by|on|next|tomorrow|today)\b|కడతా|ఇస్తా|పంపిస్తా|दूंगा|दे दूंगा|कर दूंगा|\bdunga\b|\bde denge\b/i;
const WHEN =
  /\b(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(st|nd|rd|th)|january|february|march|april|may|june|july|august|september|october|november|december)\b|రేపు|ఈరోజు|సోమవారం|शुक्रवार|सोमवार|\bkal\b/i;
const PAID =
  /already paid|i (have )?paid|i gave (you|him|it)|paid (it|you|him|already|last)|కట్టేశా|కట్టాను|ఇచ్చేశా|चुका दिया|दे दिया|\bde diya\b|pay kar diya|bhar diya/i;
const NEEDS_OWNER =
  /dispute|wrong amount|not correct|correct amount|don'?t think so|i don'?t owe|not mine|call me back|that'?s wrong|(speak|talk) (to|with)|stop calling|don'?t call|do not call|hospital|passed away|died|death|illness|sick|తప్పు|మాట్లాడాలి|ఫోన్ చేయకండి|గొడవ|गलत|बात करनी|फोन मत|बीमार/i;

const OWNER_WILL_CALL = /call you back|will call you|కాల్ చేస్తారు|कॉल करेंगे|फोन करेंगे/i;
const READ_BACK = /is that (right|correct)|confirmed as|సరేనా|ठीक है ना/i;

function promiseOffered(line: string): boolean {
  return PROMISE.test(line) && (amountsIn(line).length > 0 || WHEN.test(line));
}

const EXPECTATIONS: readonly Expectation[] = [
  {
    id: 'missed_identity',
    label: 'Identity logged once the caller answered',
    tool: 'confirm_identity',
    matches: (line) => line.trim().length > 0,
  },
  {
    id: 'missed_promise',
    label: 'Promise saved when they offered one',
    tool: 'log_promise',
    matches: promiseOffered,
    ashaSays: (line) => READ_BACK.test(line) && amountsIn(line).length > 0,
  },
  {
    id: 'missed_payment_claim',
    label: 'Payment claim saved when they said they paid',
    tool: 'record_payment_claim',
    matches: (line) => PAID.test(line),
  },
  {
    id: 'missed_callback',
    label: 'Owner callback logged for a dispute, hardship or request',
    tool: 'request_owner_callback',
    matches: (line) => NEEDS_OWNER.test(line),
    ashaSays: (line) => OWNER_WILL_CALL.test(line),
  },
];

function quote(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim();
  return flat.length > QUOTE_CHARS ? `${flat.slice(0, QUOTE_CHARS)}…` : flat;
}

interface Lines {
  readonly caller: readonly string[];
  readonly asha: readonly string[];
}

function judge(expect: Expectation, lines: Lines, called: Set<string>): Check {
  const said = expect.ashaSays;
  const trigger = lines.caller.find(expect.matches) ??
    (said ? lines.asha.find(said) : undefined);
  let status: CheckStatus = 'na';
  let value = 'not mentioned';
  if (trigger !== undefined) {
    const ran = called.has(expect.tool);
    status = ran ? 'pass' : 'fail';
    value = ran ? `${expect.tool} ran` : `"${quote(trigger)}" but ${expect.tool} never ran`;
  }
  return { id: expect.id, label: expect.label, status, value };
}

/** One check per tool that the caller's words call for. */
export function missedToolChecks(input: MissedInput): Check[] {
  const turns = input.transcript ?? [];
  const lines: Lines = {
    caller: turns.filter((turn) => turn.role !== 'assistant').map((turn) => turn.content),
    asha: turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.content),
  };
  const called = new Set(input.tools.map((tool) => tool.tool));
  return EXPECTATIONS.map((expect) => judge(expect, lines, called));
}
