// evals/munshi/timeline.ts
// Small readers over one conversation's timeline (owner lines, Munshi moves, tool runs, in
// order), shared by the eval checks. Pure functions; nothing here calls a model.
import type { OwnerCallEvent } from '../../supabase/functions/_shared/simulator/owner-conversation.ts';
import type { EvalRun } from './types.ts';

export type ToolEvent = Extract<OwnerCallEvent, { kind: 'tool' }>;
export type MunshiEvent = Extract<OwnerCallEvent, { kind: 'munshi' }>;
export type OwnerEvent = Extract<OwnerCallEvent, { kind: 'owner' }>;

export interface Indexed<E> {
  readonly index: number;
  readonly event: E;
}

/** "He asked for WhatsApp / to send something", in the three call languages. */
export const WHATSAPP_ASK =
  /whats\s?app|send|bhej|भेज|వాట్సాప్|పంపు|పంపి|व्हाट्सऐप|व्हाट्सएप|वॉट्सऐप/i;
/** Munshi mentioning WhatsApp in any script. */
export const WHATSAPP_WORD = /whats\s?app|వాట్సాప్|व्हाट्सऐप|व्हाट्सएप|वॉट्सऐप|वाट्सऐप/i;
/** The closing question in the three languages (CLOSING_QUESTIONS, and natural variants). */
export const CLOSING_QUESTION =
  /anything else|something else|ఇంకేమైనా|ఇంకా ఏమైనా|ఇంకేం|aur kuch|kuch aur|और कुछ|कुछ और/i;

function indexed<E extends OwnerCallEvent>(
  run: EvalRun,
  isKind: (event: OwnerCallEvent) => event is E,
): readonly Indexed<E>[] {
  return run.conversation.events.flatMap((event, index) =>
    isKind(event) ? [{ index, event }] : [],
  );
}

function isTool(event: OwnerCallEvent): event is ToolEvent {
  return event.kind === 'tool';
}

function isOwner(event: OwnerCallEvent): event is OwnerEvent {
  return event.kind === 'owner';
}

/** Munshi moves that said something (a tool-only move has no words). */
function isSpokenMunshi(event: OwnerCallEvent): event is MunshiEvent {
  return event.kind === 'munshi' && event.say !== '';
}

export function toolEvents(run: EvalRun, name?: string): readonly Indexed<ToolEvent>[] {
  return indexed(run, isTool).filter((tool) => name === undefined || tool.event.name === name);
}

export function ownerEvents(run: EvalRun): readonly Indexed<OwnerEvent>[] {
  return indexed(run, isOwner);
}

export function munshiLines(run: EvalRun): readonly Indexed<MunshiEvent>[] {
  return indexed(run, isSpokenMunshi);
}

/** True when an owner line came strictly between the two timeline positions. */
export function ownerSpokeBetween(run: EvalRun, from: number, to: number): boolean {
  return ownerEvents(run).some((owner) => owner.index > from && owner.index < to);
}

/** The text a tool reply gave Munshi: its `say` plus its data fields. */
export function replyText(tool: ToolEvent): string {
  const { result } = tool;
  return result.ok ? `${result.say} ${JSON.stringify(result.data)}` : result.say;
}

/** A prepare tool that stored a change waiting for his yes (it returned an action_ref). */
export function isStoredPrepare(tool: ToolEvent): boolean {
  return tool.name.startsWith('prepare_') && tool.result.ok && 'action_ref' in tool.result.data;
}

/** A tool reply that offered choices (unclear name or several entries/claims). */
export function offeredChoices(tool: ToolEvent): boolean {
  if (!tool.result.ok) return false;
  const count = tool.result.data['choice_count'];
  return typeof count === 'number' && count > 1;
}

export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '').length;
}
