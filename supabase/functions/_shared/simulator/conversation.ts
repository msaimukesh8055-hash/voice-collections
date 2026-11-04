// supabase/functions/_shared/simulator/conversation.ts
// The turn loop of a simulated call (SPEC §7.7, M5 Decision 6). Asha opens with her greeting
// (as on a live call); then, up to 10 times, the shopkeeper answers and Asha replies. Asha may
// call up to 3 tools before she must speak; every tool goes through `runTool`, which is the same
// registry, identity guard and audit row as a live call. The call ends when Asha says goodbye,
// the shopkeeper hangs up, 10 turns pass, or either model fails. Only spoken words go into the
// transcript; tool replies stay in Asha's own context, exactly as on Sarvam.
// sarvam-105b sometimes repeats a tool it already used (same name and arguments) instead of
// speaking: a repeat is not run again (no duplicate rows); she gets the earlier reply back
// (CP2 smoke finding, 2026-11-04).
import type { ChatMessage } from '../llm/json-llm.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { type ToolResult, toReplyBody } from '../tools/types.ts';
import { type AshaMove, parseAshaMove, parseShopkeeperMove } from './moves.ts';

/** Shopkeeper replies per call (M5 Decision 6). */
export const MAX_TURNS = 10;
/** Tool calls Asha may chain before she has to say something. */
export const MAX_TOOL_STEPS = 3;
/** Asha's context starts with this, so the conversation opens with a user turn. */
export const CALL_CONNECTED = '(The call has connected. Your greeting has been spoken.)';

/** One model answer as raw text; null when the model failed (already logged by the caller). */
export type ChatFn = (messages: readonly ChatMessage[]) => Promise<string | null>;

export interface ConversationDeps {
  readonly asha: ChatFn;
  readonly shopkeeper: ChatFn;
  readonly runTool: (name: string, args: unknown) => Promise<ToolResult>;
}

export type EndReason =
  | 'asha_ended'
  | 'shopkeeper_hung_up'
  | 'max_turns'
  | 'asha_failed'
  | 'shopkeeper_failed';

export interface Conversation {
  readonly transcript: readonly Turn[];
  readonly end: EndReason;
  readonly toolCalls: number;
}

interface State {
  readonly transcript: Turn[];
  readonly ashaContext: ChatMessage[];
  readonly shopkeeperContext: ChatMessage[];
  /** Every tool call made so far in this call (name + arguments) and the reply it got. */
  readonly toolReplies: Map<string, string>;
  toolCalls: number;
}

interface AshaTurn {
  readonly spoken: string;
  readonly endCall: boolean;
}

type ToolMove = AshaMove & { tool: NonNullable<AshaMove['tool']> };

function asJson(move: AshaMove): string {
  return JSON.stringify({ say: move.say, tool: move.tool, end_call: move.end_call });
}

function toolKey(tool: ToolMove['tool']): string {
  return `${tool.name} ${JSON.stringify(tool.args)}`;
}

/** Records Asha's tool call and its reply in Sarvam's native tool format (with declared tools,
 * sarvam-105b repeats a call whose reply comes back as plain text). A repeat gets the earlier
 * reply without running the tool again. */
async function runAshaTool(move: ToolMove, state: State, deps: ConversationDeps): Promise<void> {
  const id = `call_${state.ashaContext.length}`;
  const { name, args } = move.tool;
  state.ashaContext.push({ role: 'assistant', content: move.say, toolCall: { id, name, args } });
  const key = toolKey(move.tool);
  let reply = state.toolReplies.get(key);
  if (reply === undefined) {
    const result = await deps.runTool(name, args);
    state.toolCalls += 1;
    reply = `TOOL REPLY ${name}: ${JSON.stringify(toReplyBody(result))}`;
    state.toolReplies.set(key, reply);
  }
  state.ashaContext.push({ role: 'tool', toolCallId: id, content: reply });
}

/** Asha's answer to the shopkeeper's last line, tools included; null when she failed. */
async function ashaTurn(state: State, deps: ConversationDeps): Promise<AshaTurn | null> {
  const spoken: string[] = [];
  // Always ends by a return: from step MAX_TOOL_STEPS on, no tool runs and nothing is awaited.
  for (let step = 0;; step += 1) {
    const raw = await deps.asha([...state.ashaContext]);
    const move = raw === null ? null : parseAshaMove(raw);
    if (!move) return null;
    if (move.say !== '') spoken.push(move.say);
    const mayUseTool = step < MAX_TOOL_STEPS;
    // A tool sent with the goodbye (e.g. an owner callback) still runs.
    if (mayUseTool && move.tool) await runAshaTool({ ...move, tool: move.tool }, state, deps);
    else state.ashaContext.push({ role: 'assistant', content: asJson({ ...move, tool: null }) });
    const waitsForTool = mayUseTool && move.tool !== null && !move.end_call;
    if (!waitsForTool) return { spoken: spoken.join(' '), endCall: move.end_call };
  }
}

function startState(greeting: string): State {
  const opening = { say: greeting, tool: null, end_call: false };
  return {
    transcript: [{ role: 'assistant', content: greeting }],
    ashaContext: [
      { role: 'user', content: CALL_CONNECTED },
      { role: 'assistant', content: JSON.stringify(opening) },
    ],
    shopkeeperContext: [{ role: 'user', content: greeting }],
    toolReplies: new Map(),
    toolCalls: 0,
  };
}

/** One shopkeeper line then Asha's reply; the end reason, or null to carry on. */
async function exchange(state: State, deps: ConversationDeps): Promise<EndReason | null> {
  const raw = await deps.shopkeeper([...state.shopkeeperContext]);
  const line = raw === null ? null : parseShopkeeperMove(raw);
  if (!line) return 'shopkeeper_failed';
  state.transcript.push({ role: 'user', content: line.say });
  state.shopkeeperContext.push({ role: 'assistant', content: JSON.stringify(line) });
  state.ashaContext.push({ role: 'user', content: `SHOPKEEPER: ${line.say}` });
  if (line.hang_up) return 'shopkeeper_hung_up';
  const reply = await ashaTurn(state, deps);
  if (!reply || reply.spoken === '') return 'asha_failed';
  state.transcript.push({ role: 'assistant', content: reply.spoken });
  state.shopkeeperContext.push({ role: 'user', content: reply.spoken });
  return reply.endCall ? 'asha_ended' : null;
}

export async function converse(greeting: string, deps: ConversationDeps): Promise<Conversation> {
  const state = startState(greeting);
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const end = await exchange(state, deps);
    if (end) return { transcript: state.transcript, end, toolCalls: state.toolCalls };
  }
  return { transcript: state.transcript, end: 'max_turns', toolCalls: state.toolCalls };
}
