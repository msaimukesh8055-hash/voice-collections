// supabase/functions/whatsapp-webhook/slash.ts
// Text the router answers in code before any name lookup or LLM (2026-11-08):
//   • "call Munshi" / "Munshi" / मुंशी / మున్షీ (owner-call-phrase.ts) → the Munshi link, exactly
//     the Menu row's startOwnerCall with its limits (bug fix: it was read as a shopkeeper name)
//   • "/" commands (slash-commands.ts), from a typed lookup map: each runs today's command or
//     builder. /paid, /add, /asha (/reminder) and /statement use the words after them (a name,
//     or "Ramesh 2000" read like the normal message); alone they ask a short question and offer
//     the pending pick list. An unknown "/xyz" gets the short command list.
// Only the words after /paid or /add can reach the LLM, and only when code cannot read them.
import { addDays } from '../_shared/clock.ts';
import { type Command } from '../_shared/brain/commands.ts';
import { interpret, type Interpretation } from '../_shared/brain/interpret.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import type { BotContext } from '../_shared/cards/context.ts';
import type { MessagePath } from '../_shared/db/book-repository.ts';
import { BROKEN_ALERT_DAYS } from '../_shared/ledger/due-alert.ts';
import { matchShopkeepers } from '../_shared/ledger/match.ts';
import { pendingOpenList } from '../_shared/ledger/views.ts';
import { claimsReplies, promisesReply } from '../_shared/ledger/waiting-views.ts';
import { promiseLists } from '../_shared/reminders/promise-lists.ts';
import { isOwnerCallRequest } from '../_shared/whatsapp/owner-call-phrase.ts';
import { blocks, type Reply, textIn } from '../_shared/whatsapp/replies.ts';
import { parseSlash, type SlashName } from '../_shared/whatsapp/slash-commands.ts';
import { type PromptCommand, slashPhrasesFor } from '../_shared/whatsapp/slash-phrases.ts';
import { startOwnerCall } from './owner-call.ts';
import { runCommand } from './run-command.ts';

export interface EarlyDeps {
  readonly llm: BrainLlm;
  /** Demo-clock "now", for the LLM prompt's date. */
  readonly demoNow: Date;
}

export interface EarlyOutcome {
  readonly replies: readonly Reply[];
  readonly path: MessagePath;
  readonly command: string;
}

/** What a handler gives back; the path is 'command' unless the LLM read the words. */
interface Handled {
  readonly replies: readonly Reply[];
  readonly path?: MessagePath;
  /** Set when the words after the command decided what ran (e.g. mark_paid). */
  readonly command?: string;
}

type SlashHandler = (rest: string, ctx: BotContext, deps: EarlyDeps) => Promise<Handled>;

/** The brain on some text: fixed commands first, then the LLM (same as a normal message). */
export function understand(
  text: string,
  ctx: BotContext,
  deps: EarlyDeps,
): Promise<Interpretation> {
  return interpret(text, {
    today: ctx.today,
    now: deps.demoNow,
    llm: deps.llm,
    isKnownName: (name) => matchShopkeepers(name, ctx.shopkeepers).kind !== 'none',
  });
}

function replied(replies: readonly Reply[]): Handled {
  return { replies };
}

function run(command: Command): SlashHandler {
  return async (_rest, ctx) => replied(await runCommand(command, ctx));
}

function promptReply(command: PromptCommand, ctx: BotContext): Reply {
  return textIn(ctx.language, (each) => blocks(...slashPhrasesFor(each).prompts[command]));
}

/** The short question, then (when anyone owes money) the pending list: a row opens that
 * shopkeeper with [Remind] [Paid in full] [Part payment]. */
async function promptWithPick(command: PromptCommand, ctx: BotContext): Promise<Handled> {
  const entries = await ctx.book.listEntries(ctx.owner.id);
  const view = { shopkeepers: ctx.shopkeepers, entries, today: ctx.today, language: ctx.language };
  const list = pendingOpenList(view);
  const prompt = promptReply(command, ctx);
  return replied(list ? [prompt, list] : [prompt]);
}

/** "/paid Ramesh 2000" reads "Ramesh 2000", which alone means credit: /paid makes it a payment. */
function asPayment(command: Command): Command {
  if (command.kind !== 'add_credit') return command;
  return { kind: 'mark_paid', name: command.name, amount: command.amount };
}

/** "/add Ramesh paid 500": /add makes it a credit (no due date said: the 15-day default). */
function asCredit(command: Command): Command {
  if (command.kind !== 'mark_paid') return command;
  return {
    kind: 'add_credit',
    name: command.name,
    amount: command.amount,
    dueDate: null,
    note: null,
  };
}

/** /paid and /add: the words read like a normal message, then pointed at a payment or a credit;
 * nothing understood → the short question. */
function entry(command: 'paid' | 'add', toward: (command: Command) => Command): SlashHandler {
  return async function entryHandler(rest, ctx, deps): Promise<Handled> {
    if (rest === '') {
      return command === 'paid'
        ? promptWithPick(command, ctx)
        : replied([promptReply(command, ctx)]);
    }
    const understood = await understand(rest, ctx, deps);
    if (!understood.command) return { replies: [promptReply(command, ctx)], path: understood.path };
    const chosen = toward(understood.command);
    const replies = await runCommand(chosen, ctx);
    return { replies, path: understood.path, command: chosen.kind };
  };
}

/** /asha and /statement: the words are a name; alone, the short question and the pick list. */
function byName(command: 'asha' | 'statement', toCommand: (name: string) => Command): SlashHandler {
  return async function nameHandler(rest, ctx): Promise<Handled> {
    if (rest === '') return promptWithPick(command, ctx);
    return replied(await runCommand(toCommand(rest), ctx));
  };
}

async function claims(_rest: string, ctx: BotContext): Promise<Handled> {
  const entries = await ctx.book.listEntries(ctx.owner.id);
  return replied(claimsReplies({ shopkeepers: ctx.shopkeepers, entries, language: ctx.language }));
}

async function promises(_rest: string, ctx: BotContext): Promise<Handled> {
  const [entries, stored] = await Promise.all([
    ctx.book.listEntries(ctx.owner.id),
    ctx.reminder.store.listAlertPromises(ctx.owner.id, addDays(ctx.today, -BROKEN_ALERT_DAYS)),
  ]);
  const lists = promiseLists({ promises: stored, entries, today: ctx.today });
  return replied([promisesReply({ lists, shopkeepers: ctx.shopkeepers, language: ctx.language })]);
}

/** /pause and /resume (M9): flips the switch every new reminder call is checked against. */
function pauseCalls(paused: boolean): SlashHandler {
  return async function pauseHandler(_rest, ctx): Promise<Handled> {
    await ctx.reminder.store.setCallsPaused(paused);
    ctx.log('info', 'calls_paused_changed', { paused });
    return replied([
      textIn(ctx.language, (each) => {
        const phrases = slashPhrasesFor(each);
        return paused ? phrases.callsPaused : phrases.callsResumed;
      }),
    ]);
  };
}

const SLASH_HANDLERS: Readonly<Record<SlashName, SlashHandler>> = {
  munshi: async (_rest, ctx) => replied(await startOwnerCall(ctx)),
  menu: run({ kind: 'help' }),
  pending: run({ kind: 'pending' }),
  due: run({ kind: 'due_alert' }),
  overdue: run({ kind: 'due_alert' }),
  paid: entry('paid', asPayment),
  add: entry('add', asCredit),
  asha: byName('asha', (name) => ({ kind: 'call_request', name })),
  claims,
  promises,
  insights: run({ kind: 'insights' }),
  statement: byName('statement', (name) => ({ kind: 'lookup', name })),
  pause: pauseCalls(true),
  resume: pauseCalls(false),
};

function helpReply(ctx: BotContext): Reply {
  return textIn(ctx.language, function helpIn(each): string {
    const phrases = slashPhrasesFor(each);
    return blocks(phrases.helpTitle, phrases.helpLines);
  });
}

async function slashOutcome(
  text: string,
  ctx: BotContext,
  deps: EarlyDeps,
): Promise<EarlyOutcome | null> {
  const slash = parseSlash(text);
  if (slash === null) return null;
  if (slash.kind === 'unknown') {
    return { replies: [helpReply(ctx)], path: 'command', command: 'slash_unknown' };
  }
  const handled = await SLASH_HANDLERS[slash.name](slash.rest, ctx, deps);
  return {
    replies: handled.replies,
    path: handled.path ?? 'command',
    command: handled.command ?? `slash_${slash.name}`,
  };
}

/**
 * The reply when the text is a Munshi request or a "/" command, else null (the usual path).
 * `ctx.language` must already be the reply language.
 */
export async function routeEarly(
  text: string,
  ctx: BotContext,
  deps: EarlyDeps,
): Promise<EarlyOutcome | null> {
  if (isOwnerCallRequest(text) && !text.trim().startsWith('/')) {
    return { replies: await startOwnerCall(ctx), path: 'command', command: 'owner_call' };
  }
  return await slashOutcome(text, ctx, deps);
}
