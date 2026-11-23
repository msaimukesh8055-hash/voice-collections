// web/src/features/trace/plainTrace.ts
// Readable traces (Saim, 2026-11-23): one call's or one message's recorded steps turned into a
// plain-English timeline: a summary line, each step with its time since the start, the tools with
// what they sent and got back, flags (failed, slow over 1 s, the same tool twice within 5 s), the
// tools that did not run, and a technical fold (mic signals, raw steps). Pure, so it is tested
// without a page. Request and token-count steps are folded into the steps they belong to.
import type { TraceStep } from '../../lib/opsSchemas.ts';
import type { Tone } from '../ops/opsFormat.ts';
import {
  bareToolText,
  providerName,
  stepNote,
  stepTitle,
  type ToolEventLike,
  type ToolText,
  toolText,
} from './plainLabels.ts';

export type { ToolEventLike };
export type Flag = 'failed' | 'refused' | 'slow' | 'duplicate';

/** The scorecard's "needed vs ran" row for one tool (only the fields used here). */
export interface ToolNeed {
  readonly tool: string;
  readonly needed: boolean;
  readonly timesMs: readonly (number | null)[];
  readonly why: string;
}

export interface AiInfo {
  readonly provider: string;
  readonly model: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly url: string | null;
}

export interface PlainItem {
  readonly key: string;
  readonly atMs: number;
  readonly title: string;
  /** The tool's or step's real name, shown small. */
  readonly name: string;
  readonly tool: string | null;
  readonly tone: Tone;
  readonly flags: readonly Flag[];
  readonly note: string | null;
  readonly durationMs: number | null;
  readonly ai: AiInfo | null;
  readonly sentGot: { readonly sent: unknown; readonly got: unknown } | null;
}

export interface NotRun {
  readonly tool: string;
  readonly text: string;
  readonly missed: boolean;
}

export interface PlainTrace {
  readonly summary: readonly string[];
  readonly items: readonly PlainItem[];
  readonly notRun: readonly NotRun[];
  readonly technical: readonly (readonly [string, string])[];
}

export interface PlainInput {
  readonly steps: readonly TraceStep[];
  readonly events?: readonly ToolEventLike[];
  readonly toolUse?: readonly ToolNeed[];
  /** "Asha" or "Munshi" for a call; omitted for a WhatsApp message or an Ops trace. */
  readonly agent?: string;
}

/** The one tool target (Agent health, Saim 2026-11-23): a tool should answer within 1 s. */
export const SLOW_TOOL_MS = 1000;
/** The same tool again this soon is a likely double call (call 5403c221: 1 s apart). */
export const DUPLICATE_WINDOW_MS = 5000;
const TOOL_STEPS = new Set(['tool_call', 'owner_tool_call']);
const START_STEPS = new Set(['call_accepted', 'owner_call_accepted']);
const END_STEPS = new Set(['call_ended', 'owner_call_ended']);
const TOKEN_STEP = 'llm_usage';
/** Matching a tool step to its stored sent/got: same tool, written within this time. */
const MATCH_WINDOW_MS = 10_000;

function time(iso: string): number {
  return new Date(iso).getTime();
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toolOf(step: TraceStep): string | null {
  if (!TOOL_STEPS.has(step.step)) return null;
  return typeof step.detail['tool'] === 'string' ? step.detail['tool'] : null;
}

export function isAiStep(step: TraceStep): boolean {
  return step.provider !== null && step.step !== TOKEN_STEP;
}

/** "2.1 s", or "514 ms" under a second. */
export function msText(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Time since the start: "+0.4 s", "+15 s", "+1 min 27 s"; "before" for setup steps. */
export function offsetText(ms: number): string {
  if (ms < 0) return 'before';
  const seconds = ms / 1000;
  if (seconds < 10) return `+${seconds.toFixed(1)} s`;
  if (seconds < 60) return `+${Math.round(seconds)} s`;
  const whole = Math.round(seconds);
  return `+${Math.floor(whole / 60)} min ${whole % 60} s`;
}

function startOf(steps: readonly TraceStep[]): number {
  const begin = steps.find((step) => START_STEPS.has(step.step)) ?? steps[0];
  return begin ? time(begin.createdAt) : 0;
}

/** Each tool step's stored sent/got: the nearest unused event of the same tool. */
function matchEvents(
  steps: readonly TraceStep[],
  events: readonly ToolEventLike[],
): Map<TraceStep, ToolEventLike> {
  const used = new Set<ToolEventLike>();
  const matched = new Map<TraceStep, ToolEventLike>();
  for (const step of steps) {
    const tool = toolOf(step);
    if (!tool) continue;
    const at = time(step.createdAt);
    const near = events
      .filter((event) => event.tool === tool && !used.has(event))
      .filter((event) => Math.abs(time(event.createdAt) - at) <= MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(time(a.createdAt) - at) - Math.abs(time(b.createdAt) - at))[0];
    if (near) {
      used.add(near);
      matched.set(step, near);
    }
  }
  return matched;
}

/** The token count that belongs to an AI step: the nearest llm_usage row in the same trace. */
function aiInfo(step: TraceStep, usage: readonly TraceStep[]): AiInfo {
  const at = time(step.createdAt);
  const own = usage
    .filter((row) => row.traceId === step.traceId && row.provider === step.provider)
    .sort((a, b) => Math.abs(time(a.createdAt) - at) - Math.abs(time(b.createdAt) - at))[0];
  const model = own?.detail['model'];
  return {
    provider: providerName(step.provider ?? ''),
    model: typeof model === 'string' ? model : null,
    tokensIn: step.tokensIn ?? own?.tokensIn ?? num(own?.detail['tokens_in']),
    tokensOut: step.tokensOut ?? own?.tokensOut ?? num(own?.detail['tokens_out']),
    url: step.langfuseUrl ?? null,
  };
}

function toneOf(step: TraceStep, text: ToolText | null): Tone {
  if (step.status === 'error' || text?.failed) return 'bad';
  if (step.status === 'warn' || text?.refused) return 'warn';
  return 'plain';
}

function flagsOf(step: TraceStep, text: ToolText | null, isTool: boolean): Flag[] {
  const flags: Flag[] = [];
  if (step.status === 'error' || text?.failed) flags.push('failed');
  else if (text?.refused) flags.push('refused');
  const ms = step.durationMs ?? num(step.detail['ms']);
  if (isTool && ms !== null && ms > SLOW_TOOL_MS) flags.push('slow');
  return flags;
}

interface Context {
  readonly start: number;
  readonly usage: readonly TraceStep[];
  readonly matched: Map<TraceStep, ToolEventLike>;
}

function stepItem(step: TraceStep, index: number, ctx: Context): PlainItem {
  const tool = toolOf(step);
  const event = ctx.matched.get(step);
  const text = tool ? (event ? toolText(event) : bareToolText(tool, step)) : null;
  return {
    key: `${step.createdAt}:${step.step}:${index}`,
    atMs: time(step.createdAt) - ctx.start,
    title: text?.title ?? stepTitle(step),
    name: tool ?? step.step,
    tool,
    tone: toneOf(step, text),
    flags: flagsOf(step, text, tool !== null),
    note: text ? text.note : stepNote(step),
    durationMs: step.durationMs ?? num(step.detail['ms']),
    ai: isAiStep(step) ? aiInfo(step, ctx.usage) : null,
    sentGot: event ? { sent: event.args, got: event.result } : null,
  };
}

/** A stored tool call with no recorded step (calls from before traces): shown from its event. */
function eventItem(event: ToolEventLike, start: number): PlainItem {
  const text = toolText(event);
  const slow = event.durationMs !== null && event.durationMs > SLOW_TOOL_MS;
  const flags: Flag[] = text.failed ? ['failed'] : text.refused ? ['refused'] : [];
  return {
    key: `${event.createdAt}:${event.tool}:event`,
    atMs: time(event.createdAt) - start,
    title: text.title,
    name: event.tool,
    tool: event.tool,
    tone: text.failed ? 'bad' : text.refused ? 'warn' : 'plain',
    flags: slow ? [...flags, 'slow'] : flags,
    note: text.note,
    durationMs: event.durationMs,
    ai: null,
    sentGot: { sent: event.args, got: event.result },
  };
}

/** A step worth a line: not the HTTP wrapper (unless it failed or is the first one) or tokens. */
function shown(step: TraceStep, index: number): boolean {
  if (step.step === TOKEN_STEP) return false;
  if (step.step !== 'request') return true;
  return step.status === 'error' || (index === 0 && step.source === 'whatsapp-webhook');
}

/** The same tool again within 5 s is flagged on the second one. */
function markDuplicates(items: readonly PlainItem[]): PlainItem[] {
  const lastAt = new Map<string, number>();
  return items.map((item) => {
    if (!item.tool) return item;
    const before = lastAt.get(item.tool);
    lastAt.set(item.tool, item.atMs);
    if (before === undefined || item.atMs - before > DUPLICATE_WINDOW_MS) return item;
    return {
      ...item,
      tone: item.tone === 'plain' ? 'warn' : item.tone,
      flags: [...item.flags, 'duplicate'],
    };
  });
}

function timelineItems(input: PlainInput, start: number): PlainItem[] {
  const events = input.events ?? [];
  const matched = matchEvents(input.steps, events);
  const usage = input.steps.filter((step) => step.step === TOKEN_STEP);
  const ctx: Context = { start, usage, matched };
  const fromSteps = input.steps.flatMap((step, index) =>
    shown(step, index) ? [stepItem(step, index, ctx)] : [],
  );
  const taken = new Set(matched.values());
  const fromEvents = events.filter((event) => !taken.has(event)).map((e) => eventItem(e, start));
  return markDuplicates([...fromSteps, ...fromEvents].sort((a, b) => a.atMs - b.atMs));
}

function notRun(toolUse: readonly ToolNeed[]): NotRun[] {
  return toolUse
    .filter((row) => row.timesMs.length === 0)
    .map((row) => ({
      tool: row.tool,
      missed: row.needed,
      text: row.needed ? `needed but never ran: ${row.why}` : `not needed, ${row.why}`,
    }));
}

const SIGNALS: readonly (readonly [string, string])[] = [
  ['replyCount', 'Agent replies'],
  ['replyP90Ms', 'Reply time, 9 in 10 under (ms)'],
  ['sigMicPeak', 'Mic peak level (0 to 1)'],
  ['sigMicSpeech', 'Times the mic heard speech'],
  ['sigInterrupt', 'Times the caller talked over the agent'],
  ['sigSpeechStart', 'Speech-start events'],
  ['sigSpeechEnd', 'Speech-end events'],
];

function technical(steps: readonly TraceStep[]): (readonly [string, string])[] {
  const ended = steps.find((step) => END_STEPS.has(step.step));
  const rows = SIGNALS.flatMap(([key, label]) => {
    const value = ended?.detail[key];
    return value === undefined || value === null ? [] : [[label, String(value)] as const];
  });
  const traces = new Set(steps.map((step) => step.traceId).filter(Boolean)).size;
  return traces > 0 ? [...rows, ['Traces (one per request)', String(traces)] as const] : rows;
}

function toolsPart(items: readonly PlainItem[]): string | null {
  const tools = items.filter((item) => item.tool !== null);
  if (tools.length === 0) return null;
  const count = (flag: Flag): number => tools.filter((item) => item.flags.includes(flag)).length;
  const issues = (['failed', 'refused', 'duplicate', 'slow'] as const)
    .map((flag) => [flag, count(flag)] as const)
    .filter(([, n]) => n > 0)
    .map(([flag, n]) => `${n} ${flag === 'slow' ? 'over 1 s' : flag}`);
  const head = `${tools.length} tool call${tools.length === 1 ? '' : 's'}`;
  return issues.length === 0 ? `${head}, all OK` : `${head}: ${issues.join(', ')}`;
}

function callSummary(input: PlainInput, items: readonly PlainItem[]): string[] {
  const ended = input.steps.find((step) => END_STEPS.has(step.step));
  const seconds = num(ended?.detail['seconds']);
  const p50 = num(ended?.detail['replyP50Ms']);
  const max = num(ended?.detail['replyMaxMs']);
  const done = input.steps.find((step) => step.step === 'followup_run');
  const parts = [
    seconds === null ? null : `${seconds} s call`,
    toolsPart(items),
    p50 === null || max === null
      ? null
      : `${input.agent ?? 'The agent'} replied in ${msText(p50)} typically, ${msText(max)} at worst`,
    done && ended
      ? `follow-up done ${msText(time(done.createdAt) - time(ended.createdAt))} after hang-up`
      : null,
  ];
  return parts.filter((part): part is string => part !== null);
}

function messageSummary(steps: readonly TraceStep[], message: TraceStep): string[] {
  const total = message.durationMs ?? num(message.detail['ms']) ?? 0;
  const ai = steps.filter(isAiStep).reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  if (ai === 0) return [`Took ${msText(total)}, all in code (no AI)`];
  const rest = Math.max(0, total - ai);
  return [
    `Took ${msText(total)}: AI ${msText(ai)}`,
    `building and sending replies ${msText(rest)}`,
  ];
}

function plainSummary(steps: readonly TraceStep[]): string[] {
  if (steps.length === 0) return ['No steps recorded'];
  const span = time(steps[steps.length - 1]?.createdAt ?? '') - time(steps[0]?.createdAt ?? '');
  const failed = steps.filter((step) => step.status === 'error').length;
  return [
    `${steps.length} steps over ${msText(Math.max(0, span))}`,
    failed > 0 ? `${failed} failed` : 'no errors',
  ];
}

function summaryOf(input: PlainInput, items: readonly PlainItem[]): string[] {
  if (input.agent) return callSummary(input, items);
  const message = input.steps.find((step) => step.step === 'whatsapp_message');
  return message ? messageSummary(input.steps, message) : plainSummary(input.steps);
}

export function buildPlainTrace(input: PlainInput): PlainTrace {
  const start = startOf(input.steps);
  const items = timelineItems(input, start);
  return {
    summary: summaryOf(input, items),
    items,
    notRun: notRun(input.toolUse ?? []),
    technical: technical(input.steps),
  };
}
