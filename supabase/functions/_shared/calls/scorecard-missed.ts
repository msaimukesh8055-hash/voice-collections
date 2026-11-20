// supabase/functions/_shared/calls/scorecard-missed.ts
// Live evals (Saim, 2026-11-20): "Tools: needed vs ran". For each of Asha's five tools: was it
// needed in this call, did it run, how long it took, and why it was needed (the words that called
// for it). A silent miss is the worst live-agent failure: the call sounds fine but nothing is saved,
// so a needed tool that never ran fails, quoting the words. Rules, no AI. Asha's own words count
// too: if she says the owner will call back or reads back a promise, the tool must have run. The
// word lists are English plus a few Telugu and Hindi words; the scorecard lists that as a gap.
import type { Turn } from '../sarvam-analytics.ts';
import { amountsIn } from './scorecard-amounts.ts';
import type { Check, CheckStatus } from './scorecard.ts';

export interface ToolUseRow {
  readonly tool: string;
  readonly needed: boolean;
  readonly timesMs: readonly (number | null)[];
  /** pass: needed and ran (or ran anyway); fail: needed, never ran; na: not needed, not run. */
  readonly status: CheckStatus;
  readonly why: string;
}

export interface UseInput {
  readonly transcript: readonly Turn[] | null;
  readonly tools: readonly {
    readonly tool: string;
    readonly result: Readonly<Record<string, unknown>>;
    readonly durationMs: number | null;
  }[];
}

export interface Lines {
  readonly caller: readonly string[];
  readonly asha: readonly string[];
  /** Every turn in order, for checks that need who spoke right before whom. */
  readonly turns: readonly Turn[];
}

export interface Need {
  readonly tool: string;
  /** The words that call for the tool, or null when nothing did. */
  readonly trigger: (lines: Lines, input: UseInput) => string | null;
  readonly notNeeded: string;
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

function quote(line: string): string {
  const flat = line.replace(/\s+/g, ' ').trim();
  return `"${flat.length > QUOTE_CHARS ? `${flat.slice(0, QUOTE_CHARS)}…` : flat}"`;
}

/** The first caller line that matches, else (when given) the first Asha line that does. */
export function said(
  lines: Lines,
  caller: (line: string) => boolean,
  asha?: (line: string) => boolean,
): string | null {
  const theirs = lines.caller.find(caller);
  if (theirs !== undefined) return quote(theirs);
  const hers = asha ? lines.asha.find(asha) : undefined;
  return hers === undefined ? null : `Asha said ${quote(hers)}`;
}

function promiseOffered(line: string): boolean {
  return PROMISE.test(line) && (amountsIn(line).length > 0 || WHEN.test(line));
}

function identityConfirmed(input: UseInput): boolean {
  return input.tools.some((tool) => {
    const data = tool.result['data'];
    return tool.tool === 'confirm_identity' && typeof data === 'object' && data !== null &&
      (data as Record<string, unknown>)['identity'] === 'confirmed';
  });
}

/** In Asha's order through a call. */
const ASHA_NEEDS: readonly Need[] = [
  {
    tool: 'confirm_identity',
    trigger: (lines) => {
      const first = lines.caller.find((line) => line.trim().length > 0);
      return first === undefined ? null : quote(first);
    },
    notNeeded: 'nobody answered',
  },
  {
    tool: 'get_dues',
    trigger: (_lines, input) => identityConfirmed(input) ? 'identity confirmed' : null,
    notNeeded: 'identity not confirmed',
  },
  {
    tool: 'log_promise',
    trigger: (lines) =>
      said(lines, promiseOffered, (line) => READ_BACK.test(line) && amountsIn(line).length > 0),
    notNeeded: 'no promise offered',
  },
  {
    tool: 'record_payment_claim',
    trigger: (lines) => said(lines, (line) => PAID.test(line)),
    notNeeded: 'never said they had paid',
  },
  {
    tool: 'request_owner_callback',
    trigger: (lines) =>
      said(lines, (line) => NEEDS_OWNER.test(line), (line) => OWNER_WILL_CALL.test(line)),
    notNeeded: 'no dispute, hardship or request for the owner',
  },
];

function row(need: Need, lines: Lines, input: UseInput): ToolUseRow {
  const timesMs = input.tools.filter((tool) => tool.tool === need.tool).map((t) => t.durationMs);
  const ran = timesMs.length > 0;
  const trigger = need.trigger(lines, input);
  const base = { tool: need.tool, needed: trigger !== null, timesMs };
  if (trigger === null) {
    return ran
      ? { ...base, status: 'pass', why: "ran; the words that called for it weren't recognised" }
      : { ...base, status: 'na', why: need.notNeeded };
  }
  if (ran) return { ...base, status: 'pass', why: trigger };
  const skippedDues = need.tool === 'get_dues' &&
    input.tools.some((tool) => tool.tool === 'request_owner_callback');
  return skippedDues
    ? { ...base, needed: false, status: 'na', why: 'skipped: handed to the owner first' }
    : { ...base, status: 'fail', why: `${trigger}, but it never ran` };
}

/** One row per agent tool (Asha's by default): needed or not, ran or not, and why. */
export function toolUse(input: UseInput, needs: readonly Need[] = ASHA_NEEDS): ToolUseRow[] {
  const turns = input.transcript ?? [];
  const lines: Lines = {
    caller: turns.filter((turn) => turn.role !== 'assistant').map((turn) => turn.content),
    asha: turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.content),
    turns,
  };
  return needs.map((need) => row(need, lines, input));
}

/** The rows as checks, so they count in the scorecard's verdict and "N of M passed". */
export function toolUseChecks(rows: readonly ToolUseRow[]): Check[] {
  return rows.map((one) => ({
    id: `tool_use_${one.tool}`,
    label: `${one.tool} ran when needed`,
    status: one.status,
    value: one.why,
  }));
}
