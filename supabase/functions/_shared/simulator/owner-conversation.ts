// supabase/functions/_shared/simulator/owner-conversation.ts
// One text conversation between Munshi and a simulated owner (M8 C1): the same turn loop as
// Asha's simulated calls (conversation.ts), with the owner's lines labelled OWNER and a 12-turn
// cap. On top, it keeps a timeline of what happened, in order (owner lines, Munshi's moves, every
// tool run with its reply), which the eval checks read: e.g. "an owner line came between the
// prepare and the confirm".
// Time is simulated, not real: each owner line, Munshi move and tool run moves the clock on by a
// fixed step, so the confirm gate's 2-second rule behaves as on a voice call (a prepare and a
// confirm chained in one Munshi turn are under 2 s apart; his spoken answer is not) and a run
// is deterministic however slow the models are.
import type { Turn } from '../sarvam-analytics.ts';
import type { ToolResult } from '../tools/types.ts';
import { type ChatFn, converse, type EndReason } from './conversation.ts';
import { OWNER_LABEL } from './munshi-text.ts';
import { parseAshaMove, parseShopkeeperMove } from './moves.ts';

/** The owner's replies per conversation (budget: one eval run stays small). */
export const MAX_OWNER_TURNS = 12;
/** Simulated time for him to say one line. */
export const OWNER_LINE_MS = 4_000;
/** Simulated time for one Munshi move (model answer, before any tool runs). */
export const MUNSHI_MOVE_MS = 1_500;
/** Simulated server time of one tool call. */
export const TOOL_RUN_MS = 300;

export type OwnerEndReason =
  | 'munshi_ended'
  | 'owner_hung_up'
  | 'max_turns'
  | 'munshi_failed'
  | 'owner_failed';

const END_REASONS: Readonly<Record<EndReason, OwnerEndReason>> = {
  asha_ended: 'munshi_ended',
  shopkeeper_hung_up: 'owner_hung_up',
  max_turns: 'max_turns',
  asha_failed: 'munshi_failed',
  shopkeeper_failed: 'owner_failed',
};

export type OwnerCallEvent =
  | { readonly kind: 'owner'; readonly say: string; readonly at: string }
  | {
    readonly kind: 'munshi';
    readonly say: string;
    readonly tool: string | null;
    readonly endCall: boolean;
    readonly at: string;
  }
  | {
    readonly kind: 'tool';
    readonly name: string;
    readonly args: unknown;
    readonly result: ToolResult<string>;
    readonly at: string;
  };

export interface OwnerConversationDeps {
  readonly munshi: ChatFn;
  readonly owner: ChatFn;
  /** Runs one owner tool in-process at the simulated time `realNow`. */
  readonly runTool: (name: string, args: unknown, realNow: Date) => Promise<ToolResult<string>>;
  /** Simulated time the conversation starts at. */
  readonly startAt: Date;
}

export interface OwnerConversation {
  readonly transcript: readonly Turn[];
  readonly end: OwnerEndReason;
  readonly toolCalls: number;
  readonly events: readonly OwnerCallEvent[];
}

function simulatedClock(startAt: Date): (stepMs: number) => string {
  let now = startAt.getTime();
  return function advance(stepMs: number): string {
    now += stepMs;
    return new Date(now).toISOString();
  };
}

interface Recorder {
  readonly events: OwnerCallEvent[];
  readonly advance: (stepMs: number) => string;
}

/** The owner's model, recording each usable line (parsed exactly as the loop parses it). */
function recordedOwner(ask: ChatFn, recorder: Recorder): ChatFn {
  return async function owner(messages): Promise<string | null> {
    const raw = await ask(messages);
    const move = raw === null ? null : parseShopkeeperMove(raw);
    if (move) {
      recorder.events.push({ kind: 'owner', say: move.say, at: recorder.advance(OWNER_LINE_MS) });
    }
    return raw;
  };
}

/** Munshi's model, recording each usable move (words, the tool he asked for, end_call). */
function recordedMunshi(ask: ChatFn, recorder: Recorder): ChatFn {
  return async function munshi(messages): Promise<string | null> {
    const raw = await ask(messages);
    const move = raw === null ? null : parseAshaMove(raw);
    if (move) {
      const at = recorder.advance(MUNSHI_MOVE_MS);
      const tool = move.tool?.name ?? null;
      recorder.events.push({ kind: 'munshi', say: move.say, tool, endCall: move.end_call, at });
    }
    return raw;
  };
}

function recordedTools(
  run: OwnerConversationDeps['runTool'],
  recorder: Recorder,
): (name: string, args: unknown) => Promise<ToolResult<string>> {
  return async function runTool(name, args): Promise<ToolResult<string>> {
    const at = recorder.advance(TOOL_RUN_MS);
    const result = await run(name, args, new Date(at));
    recorder.events.push({ kind: 'tool', name, args, result, at });
    return result;
  };
}

export async function converseOwner(
  greeting: string,
  deps: OwnerConversationDeps,
): Promise<OwnerConversation> {
  const recorder: Recorder = { events: [], advance: simulatedClock(deps.startAt) };
  const conversation = await converse(greeting, {
    asha: recordedMunshi(deps.munshi, recorder),
    shopkeeper: recordedOwner(deps.owner, recorder),
    runTool: recordedTools(deps.runTool, recorder),
    userLabel: OWNER_LABEL,
    maxTurns: MAX_OWNER_TURNS,
  });
  return { ...conversation, end: END_REASONS[conversation.end], events: [...recorder.events] };
}
