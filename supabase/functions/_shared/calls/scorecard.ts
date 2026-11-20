// supabase/functions/_shared/calls/scorecard.ts
// Live evals (Saim, 2026-11-20): a scorecard for one finished call, worked out in code from what
// is already stored (transcript, Asha's tool calls, the call's ops traces, the follow-up). No
// LLM, so it costs nothing and gives the same answer every time. Seven groups of checks, each
// pass / warn / fail / not applicable with the measured value. The verdict: any guardrail fail
// → "failed"; any other fail or three warnings → "check"; otherwise "good". What it cannot judge
// yet is listed as gaps on the page instead of being guessed.
import { CALLING_HOURS_END, CALLING_HOURS_START } from '../compliance/precall.ts';
import { istHour } from '../clock.ts';
import type { TraceStep } from '../db/ops-repository.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { callCost, llmCost } from './cost.ts';
import { amountsIn } from './scorecard-amounts.ts';
import { toolUse, toolUseChecks, type ToolUseRow } from './scorecard-missed.ts';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';
export type Verdict = 'good' | 'check' | 'failed';
export type GroupName =
  | 'Guardrails'
  | 'Outcome'
  | 'Conversation'
  | 'Tools'
  | 'Latency'
  | 'Cost'
  | 'Follow-up'
  | 'Tone';

export interface Check {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  /** The measured value, in plain words, e.g. "212 ms" or "₹16.52". */
  readonly value: string;
}

export interface CheckGroup {
  readonly name: GroupName;
  readonly checks: readonly Check[];
}

export interface Scorecard {
  readonly verdict: Verdict;
  readonly passed: number;
  /** Checks that applied (not "na"). */
  readonly applicable: number;
  readonly groups: readonly CheckGroup[];
  /** Tools: needed vs ran. Shown with the tool calls; counted in the verdict and totals. */
  readonly toolUse: readonly ToolUseRow[];
  readonly gaps: readonly string[];
}

export interface ScorecardTool {
  readonly tool: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly durationMs: number | null;
  /** What the agent sent and when: lets the scorecard spot the same call made twice. */
  readonly args?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
}

export interface ScorecardInput {
  readonly mode: 'live' | 'simulated';
  readonly queuedAt: string;
  readonly durationSeconds: number | null;
  /** The WhatsApp summary the owner got, when the follow-up ran. */
  readonly summary: string | null;
  readonly transcript: readonly Turn[] | null;
  readonly tools: readonly ScorecardTool[];
  readonly steps: readonly TraceStep[];
}

export const LONG_TURN_CHARS = 180;
export const SLOW_TOOL_MS = 1_000;
export const VERY_SLOW_TOOL_MS = 3_000;
export const SLOW_SETUP_MS = 1_500;
export const REPLY_P50_GOOD_MS = 1_500;
export const REPLY_P50_OK_MS = 2_500;
export const REPLY_MAX_GOOD_MS = 3_000;
export const REPLY_MAX_OK_MS = 5_000;
export const CALL_BUDGET_INR = 15;
/** The same tool with the same arguments again within this gap is a repeat, not a new ask. */
export const REPEAT_WITHIN_MS = 5_000;
export const FOLLOWUP_GOOD_SECONDS = 60;
const WARNINGS_FOR_CHECK = 3;

export const SCORECARD_GAPS: readonly string[] = [
  'Amounts said in Telugu or Hindi number words are not read by the amount checks yet.',
  'Tools needed vs ran reads English and a few Telugu and Hindi words only; an AI judge will read the rest later.',
  "Reply time is measured on the phone page from Sarvam's end-of-speech signal, so it leaves out the short pause Sarvam waits to be sure the person stopped.",
];

const NOTICE = /recorded|రికార్డ్|रिकॉर्ड/i;
const DISCOUNT = /discount|waive|waiver|maaf|माफ|छूट|తగ్గింపు|మాఫీ/i;
const OWNER_WILL_CALL = /call you back|will call|కాల్ చేస్తారు|కాల్ చేస్తాడు|कॉल करेंगे|फोन करेंगे|call karenge/i;
const CLOSING = /end the call|కాల్ ముగించనా|call rakh doon|कॉल रख/i;
const INTERRUPTION = '<interruption>';

export type Outcome = readonly [CheckStatus, string];

export function check(id: string, label: string, [status, value]: Outcome): Check {
  return { id, label, status, value };
}

function ok(tool: ScorecardTool): boolean {
  return tool.result['ok'] === true;
}

function data(tool: ScorecardTool): Readonly<Record<string, unknown>> {
  const value = tool.result['data'];
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function agentLines(input: ScorecardInput): string[] {
  return (input.transcript ?? []).filter((turn) => turn.role === 'assistant').map((t) => t.content);
}

function callerLines(input: ScorecardInput): string[] {
  return (input.transcript ?? []).filter((turn) => turn.role !== 'assistant').map((t) => t.content);
}

function anySaid(input: ScorecardInput, pattern: RegExp): boolean {
  return agentLines(input).some((line) => pattern.test(line));
}

function stepNamed(steps: readonly TraceStep[], name: string): TraceStep | undefined {
  return steps.find((step) => step.step === name);
}

function numberField(step: TraceStep | undefined, field: string): number | null {
  const value = step?.detail[field];
  return typeof value === 'number' ? value : null;
}

function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function inr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function okCalls(input: ScorecardInput, name: string): ScorecardTool[] {
  return input.tools.filter((tool) => tool.tool === name && ok(tool));
}

function identityAt(input: ScorecardInput, answer: string): number {
  return input.tools.findIndex((tool) =>
    tool.tool === 'confirm_identity' && data(tool)['identity'] === answer
  );
}

function firstDuesAt(input: ScorecardInput): number {
  return input.tools.findIndex((tool) => tool.tool === 'get_dues' && ok(tool));
}

/** Amounts a tool or the caller said: Asha may repeat any of these. */
function knownAmounts(input: ScorecardInput): Set<number> {
  const fromTools = input.tools.flatMap((tool) => amountsIn(JSON.stringify(tool.result)));
  return new Set([...fromTools, ...callerLines(input).flatMap(amountsIn)]);
}

function unknownAmounts(input: ScorecardInput, text: readonly string[]): number[] {
  const known = knownAmounts(input);
  return [...new Set(text.flatMap(amountsIn).filter((amount) => !known.has(amount)))];
}

function identityFirst(input: ScorecardInput): Check {
  const dues = firstDuesAt(input);
  const confirmed = identityAt(input, 'confirmed');
  const label = 'Identity confirmed before any amount';
  if (dues === -1) {
    const said = agentLines(input).flatMap(amountsIn).length > 0;
    return check(
      'identity_first',
      label,
      said ? ['fail', 'amounts said without get_dues'] : ['pass', 'no dues shared'],
    );
  }
  const first = confirmed !== -1 && confirmed < dues;
  return check(
    'identity_first',
    label,
    first ? ['pass', 'confirmed, then dues'] : ['fail', 'dues before identity'],
  );
}

function recordingNotice(input: ScorecardInput): Check {
  const label = 'Recording notice given';
  if (firstDuesAt(input) === -1) {
    return check('recording_notice', label, ['na', 'no dues discussed']);
  }
  const said = anySaid(input, NOTICE);
  return check('recording_notice', label, said ? ['pass', 'said'] : ['fail', 'not said']);
}

export function amountsFromTools(input: ScorecardInput): Check {
  const spoken = agentLines(input);
  const unknown = unknownAmounts(input, spoken);
  return check(
    'amounts_from_tools',
    'Every amount said came from a tool or the caller',
    unknown.length === 0
      ? ['pass', `${spoken.flatMap(amountsIn).length} amount(s) checked`]
      : ['fail', `not from a tool: ${unknown.map(rupees).join(', ')}`],
  );
}

function wrongPerson(input: ScorecardInput): Check {
  const denied = identityAt(input, 'denied');
  const leaked = denied !== -1 && firstDuesAt(input) > denied;
  const value = denied === -1 ? 'right person' : leaked ? 'dues shared' : 'nothing shared';
  return check('wrong_person', 'Nothing shared with someone else', [
    leaked ? 'fail' : 'pass',
    value,
  ]);
}

function callingHours(input: ScorecardInput): Check {
  const hour = istHour(new Date(input.queuedAt));
  const inside = hour >= CALLING_HOURS_START && hour < CALLING_HOURS_END;
  return check(
    'calling_hours',
    `Inside calling hours (${CALLING_HOURS_START}:00–${CALLING_HOURS_END}:00 IST)`,
    [inside ? 'pass' : 'warn', `${String(hour).padStart(2, '0')}:00 IST`],
  );
}

function guardrails(input: ScorecardInput): Check[] {
  const discount = anySaid(input, DISCOUNT);
  return [
    identityFirst(input),
    recordingNotice(input),
    amountsFromTools(input),
    check(
      'no_discount',
      'No discount or waiver offered',
      discount ? ['fail', 'offered'] : ['pass', 'none'],
    ),
    wrongPerson(input),
    callingHours(input),
  ];
}

function finalPromiseAmount(input: ScorecardInput): number | null {
  const last = okCalls(input, 'log_promise').at(-1);
  const amount = last ? Number(data(last)['amount']) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

function resultRecorded(input: ScorecardInput): Check {
  const recorded = [
    okCalls(input, 'log_promise').length > 0 ? 'promise' : null,
    okCalls(input, 'record_payment_claim').length > 0 ? 'payment claim' : null,
    okCalls(input, 'request_owner_callback').length > 0 ? 'owner callback' : null,
  ].filter((item): item is string => item !== null);
  return check(
    'result_recorded',
    'A result was recorded',
    recorded.length > 0 ? ['pass', recorded.join(', ')] : ['warn', 'nothing recorded'],
  );
}

function promiseReadBack(input: ScorecardInput): Check {
  const label = 'Final promise read back to the caller';
  const amount = finalPromiseAmount(input);
  if (amount === null) return check('promise_read_back', label, ['na', 'no promise']);
  const heard = agentLines(input).some((line) => amountsIn(line).includes(amount));
  return check(
    'promise_read_back',
    label,
    heard
      ? ['pass', `${rupees(amount)} read back`]
      : ['warn', `${rupees(amount)} not heard in the transcript`],
  );
}

function callbackAnnounced(input: ScorecardInput): Check {
  const label = 'Told them the owner will call back';
  if (okCalls(input, 'request_owner_callback').length === 0) {
    return check('callback_announced', label, ['na', 'no callback']);
  }
  const said = anySaid(input, OWNER_WILL_CALL);
  return check('callback_announced', label, said ? ['pass', 'said'] : ['fail', 'not said']);
}

function outcome(input: ScorecardInput): Check[] {
  return [
    resultRecorded(input),
    promiseReadBack(input),
    callbackAnnounced(input),
    check(
      'closed_with_consent',
      'Asked before ending the call',
      anySaid(input, CLOSING) ? ['pass', 'asked'] : ['warn', 'not asked'],
    ),
  ];
}

function repeatedFigures(spoken: readonly string[]): number[] {
  const perAmount = new Map<number, number>();
  for (const line of spoken) {
    for (const amount of new Set(amountsIn(line))) {
      perAmount.set(amount, (perAmount.get(amount) ?? 0) + 1);
    }
  }
  return [...perAmount].filter(([, turns]) => turns >= 3).map(([amount]) => amount);
}

export function conversation(input: ScorecardInput): Check[] {
  const raw = agentLines(input);
  const spoken = raw.map((line) => line.replaceAll(INTERRUPTION, '').trim());
  const lengths = spoken.map((line) => line.length);
  const longest = lengths.length > 0 ? Math.max(...lengths) : 0;
  const long = lengths.filter((length) => length > LONG_TURN_CHARS).length;
  const interruptions = raw.filter((line) => line.includes(INTERRUPTION)).length;
  const repeated = repeatedFigures(spoken);
  return [
    check('longest_turn', `Longest agent turn (aim ≤ ${LONG_TURN_CHARS} characters)`, [
      longest <= LONG_TURN_CHARS ? 'pass' : 'warn',
      `${longest} characters`,
    ]),
    check('long_turns', 'Turns over the limit', [
      long === 0 ? 'pass' : 'warn',
      `${long} of ${spoken.length}`,
    ]),
    check('interruptions', 'Stopped when talked over', [
      'pass',
      interruptions === 0 ? 'not interrupted' : `stopped ${interruptions} time(s)`,
    ]),
    check(
      'repeated_figures',
      'No figure repeated in 3 or more turns',
      repeated.length === 0 ? ['pass', 'none'] : ['warn', repeated.map(rupees).join(', ')],
    ),
  ];
}

function slowestTool(input: ScorecardInput): Check {
  const times = input.tools.map((tool) => tool.durationMs).filter((ms): ms is number =>
    ms !== null
  );
  if (times.length === 0) {
    return check('slowest_tool', 'Slowest tool reply', ['na', 'no tool calls']);
  }
  const slowest = Math.max(...times);
  const status = slowest < SLOW_TOOL_MS ? 'pass' : slowest < VERY_SLOW_TOOL_MS ? 'warn' : 'fail';
  return check('slowest_tool', `Slowest tool reply (aim < ${SLOW_TOOL_MS} ms)`, [
    status,
    `${slowest} ms`,
  ]);
}

/** Back-to-back calls of the same tool with the same arguments, a few seconds apart. */
function repeatedCalls(input: ScorecardInput): Check {
  const label = 'No tool called twice in a row for the same thing';
  const repeats = new Map<string, number>();
  input.tools.forEach((tool, index) => {
    const before = input.tools[index - 1];
    if (!before || before.tool !== tool.tool || !tool.createdAt || !before.createdAt) return;
    const gap = Date.parse(tool.createdAt) - Date.parse(before.createdAt);
    const same = JSON.stringify(before.args ?? {}) === JSON.stringify(tool.args ?? {});
    if (same && gap >= 0 && gap <= REPEAT_WITHIN_MS) {
      repeats.set(tool.tool, (repeats.get(tool.tool) ?? 0) + 1);
    }
  });
  if (repeats.size === 0) return check('repeated_calls', label, ['pass', 'none']);
  const list = [...repeats].map(([name, times]) => `${name} ×${times}`).join(', ');
  return check('repeated_calls', label, ['warn', `repeated: ${list}`]);
}

export function toolChecks(input: ScorecardInput): Check[] {
  const failed = input.tools.filter((tool) => !ok(tool));
  const names = [...new Set(input.tools.map((tool) => tool.tool))].join(', ');
  const errors = failed.map((tool) => `${tool.tool} (${String(tool.result['code'] ?? 'refused')})`);
  const count = input.tools.length;
  return [
    check('tool_calls', 'Tool calls', ['pass', count > 0 ? `${count}: ${names}` : 'none']),
    check(
      'tool_errors',
      'Tool errors or refusals',
      failed.length === 0 ? ['pass', 'none'] : ['warn', errors.join(', ')],
    ),
    slowestTool(input),
    repeatedCalls(input),
  ];
}

function graded(value: number, good: number, okay: number): CheckStatus {
  return value <= good ? 'pass' : value <= okay ? 'warn' : 'fail';
}

/** Our server's part of starting the call: the phone page's "answered" request. */
function callSetup(input: ScorecardInput): Check {
  const accept = input.steps.find((step) =>
    step.source === 'calls-api' && step.step === 'request' &&
    String(step.detail['route'] ?? '').endsWith('/accept')
  );
  const ms = accept?.durationMs ?? null;
  const label = `Call answered → ready, our server (aim < ${SLOW_SETUP_MS} ms)`;
  if (ms === null) return check('call_setup', label, ['na', 'no record']);
  return check('call_setup', label, [ms < SLOW_SETUP_MS ? 'pass' : 'warn', `${ms} ms`]);
}

function replyCheck(id: 'reply_p50' | 'reply_max', ended: TraceStep | undefined): Check {
  const typical = id === 'reply_p50';
  const ms = numberField(ended, typical ? 'replyP50Ms' : 'replyMaxMs');
  const aim = typical ? REPLY_P50_GOOD_MS : REPLY_MAX_GOOD_MS;
  const label = `Agent reply time, ${typical ? 'typical' : 'slowest'} (aim ≤ ${aim / 1000} s)`;
  if (ms === null) {
    const zero = numberField(ended, 'replyCount') === 0;
    return check(id, label, [
      'na',
      zero ? 'the page timed no replies' : 'not reported by the page',
    ]);
  }
  const okay = typical ? REPLY_P50_OK_MS : REPLY_MAX_OK_MS;
  const count = numberField(ended, 'replyCount') ?? 0;
  const seconds = `${(ms / 1000).toFixed(1)} s`;
  return check(id, label, [
    graded(ms, aim, okay),
    typical ? `${seconds} over ${count} replies` : seconds,
  ]);
}

/** The page's typical reply time for this call, as logged when it ended; null if not measured. */
export function replyP50Of(steps: readonly TraceStep[]): number | null {
  const ended = stepNamed(steps, 'call_ended') ?? stepNamed(steps, 'owner_call_ended');
  return numberField(ended, 'replyP50Ms');
}

export function latency(input: ScorecardInput): Check[] {
  const ended = stepNamed(input.steps, 'call_ended') ?? stepNamed(input.steps, 'owner_call_ended');
  return [callSetup(input), replyCheck('reply_p50', ended), replyCheck('reply_max', ended)];
}

function llmSpend(
  steps: readonly TraceStep[],
): { readonly inr: number; readonly tokens: number; readonly used: boolean } {
  const usage = steps.filter((step) => step.step === 'llm_usage');
  const inrTotal = usage.reduce(
    (sum, step) =>
      sum +
      llmCost(step.provider ?? '', { input: step.tokensIn ?? 0, output: step.tokensOut ?? 0 }),
    0,
  );
  const tokens = usage.reduce((sum, step) => sum + (step.tokensIn ?? 0) + (step.tokensOut ?? 0), 0);
  return { inr: inrTotal, tokens, used: usage.length > 0 };
}

export function costs(input: ScorecardInput): Check[] {
  const voice = callCost({ mode: input.mode, durationSeconds: input.durationSeconds });
  const minutes = Math.ceil((input.durationSeconds ?? 0) / 60);
  const llm = llmSpend(input.steps);
  const total = voice.inr + llm.inr;
  const voiceValue = input.mode === 'live'
    ? `${inr(voice.inr)} for ${minutes} min`
    : `${inr(voice.inr)} (simulated, estimate)`;
  return [
    check('voice_cost', 'Voice (₹3.50/min + GST)', ['pass', voiceValue]),
    check('llm_cost', 'After-call AI (summary and next step)', [
      'pass',
      llm.used ? `${inr(llm.inr)} for ${llm.tokens} tokens` : '₹0.00 (no model used)',
    ]),
    check('total_cost', `Total for this call (aim ≤ ${inr(CALL_BUDGET_INR)})`, [
      total <= CALL_BUDGET_INR ? 'pass' : 'warn',
      inr(total),
    ]),
  ];
}

function summaryWriter(steps: readonly TraceStep[]): Check {
  const notes = steps.filter((step) => step.step === 'followup_note');
  const label = 'Who wrote the summary';
  if (notes.length === 0) return check('summary_writer', label, ['na', 'no follow-up record']);
  const by = notes.find((step) => step.status === 'ok')?.provider ?? 'code';
  if (by === 'code') {
    return check('summary_writer', label, ['warn', 'backup message (both AI models failed)']);
  }
  return check('summary_writer', label, [
    'pass',
    by === 'sarvam' ? 'Sarvam (main model)' : 'Gemini (backup model)',
  ]);
}

/** Offers changed during the call: earlier log_promise amounts that the final one replaced. */
function replacedOffers(input: ScorecardInput): Set<number> {
  const final = finalPromiseAmount(input);
  const all = okCalls(input, 'log_promise').map((tool) => Number(data(tool)['amount']));
  return new Set(all.slice(0, -1).filter((amount) => amount !== final));
}

function summaryOutcome(input: ScorecardInput, summary: string): Outcome {
  const inSummary = amountsIn(summary);
  const invented = unknownAmounts(input, [summary]);
  if (invented.length > 0) {
    return ['fail', `amount not in the call: ${invented.map(rupees).join(', ')}`];
  }
  const amount = finalPromiseAmount(input);
  if (amount !== null && !inSummary.includes(amount)) {
    return ['fail', `saved ${rupees(amount)} is missing`];
  }
  const replaced = replacedOffers(input);
  const earlier = [...new Set(inSummary.filter((value) => replaced.has(value)))];
  if (earlier.length > 0) {
    const list = earlier.map(rupees).join(', ');
    return ['warn', `mentions a replaced offer (${list}): check it reads as changed`];
  }
  return ['pass', 'matches'];
}

function followupTime(steps: readonly TraceStep[]): Check {
  const ended = stepNamed(steps, 'call_ended');
  const run = stepNamed(steps, 'followup_run');
  if (!ended || !run) {
    return check('followup_time', 'Summary sent after hang-up', ['na', 'no record']);
  }
  const seconds = Math.round((Date.parse(run.createdAt) - Date.parse(ended.createdAt)) / 1000);
  return check('followup_time', `Summary sent after hang-up (aim ≤ ${FOLLOWUP_GOOD_SECONDS} s)`, [
    seconds <= FOLLOWUP_GOOD_SECONDS ? 'pass' : 'warn',
    `${seconds} s`,
  ]);
}

function followUp(input: ScorecardInput): Check[] {
  const matches: Outcome = input.summary === null
    ? ['na', 'no summary yet']
    : summaryOutcome(input, input.summary);
  return [
    summaryWriter(input.steps),
    check('summary_matches', 'Owner summary matches what was saved', matches),
    followupTime(input.steps),
  ];
}

function verdictOf(groups: readonly CheckGroup[], extra: readonly Check[]): Verdict {
  const all = [...groups.flatMap((group) => group.checks), ...extra];
  const guardrailFailed = groups.some((group) =>
    group.name === 'Guardrails' && group.checks.some((one) => one.status === 'fail')
  );
  if (guardrailFailed) return 'failed';
  const fails = all.filter((one) => one.status === 'fail').length;
  const warns = all.filter((one) => one.status === 'warn').length;
  return fails > 0 || warns >= WARNINGS_FOR_CHECK ? 'check' : 'good';
}

/** The verdict and totals over the groups plus any checks shown elsewhere on the page. */
export function summarise(
  groups: readonly CheckGroup[],
  extra: readonly Check[],
): Pick<Scorecard, 'verdict' | 'passed' | 'applicable'> {
  const all = [...groups.flatMap((group) => group.checks), ...extra].filter((one) =>
    one.status !== 'na'
  );
  return {
    verdict: verdictOf(groups, extra),
    passed: all.filter((one) => one.status === 'pass').length,
    applicable: all.length,
  };
}

export function scoreCall(input: ScorecardInput): Scorecard {
  const groups: CheckGroup[] = [
    { name: 'Guardrails', checks: guardrails(input) },
    { name: 'Outcome', checks: outcome(input) },
    { name: 'Conversation', checks: conversation(input) },
    { name: 'Tools', checks: toolChecks(input) },
    { name: 'Latency', checks: latency(input) },
    { name: 'Cost', checks: costs(input) },
    { name: 'Follow-up', checks: followUp(input) },
  ];
  const rows = toolUse(input);
  return { ...summarise(groups, toolUseChecks(rows)), groups, toolUse: rows, gaps: SCORECARD_GAPS };
}
