// supabase/functions/_shared/tools/get-dues.ts
// What the shopkeeper owes (confirmed ledger entries only), plus Asha's memory and tone level
// (SPEC §7.3, §7.4, M5 Decision 2). Nothing is read, checked or shared before identity is
// confirmed. Then one round of reads, the promise check on the demo clock (so a promise that
// just broke counts), and one round of writes: any promise status change and the call's tone
// level. Sarvam gives Asha only `say`, so memory and tone are written into it as plain facts;
// how to use them is in her prompt. The LLM-written follow-up note is never read here (CP2 M2):
// everything in the reply is built in code from the shop's own records.
import { istDate } from '../clock.ts';
import { buildMemory, describeMemory, memoryData } from '../calls/memory.ts';
import {
  consequenceFor,
  countRecentBroken,
  TONE_NAMES,
  type ToneLevel,
  toneLevel,
} from '../calls/tone.ts';
import { formatDay, formatRupees } from '../format.ts';
import { computeDues, type Dues } from '../ledger/dues.ts';
import {
  applyPromiseChanges,
  checkPromises,
  type PromiseChange,
  type PromiseRecord,
} from '../ledger/promise-check.ts';
import { requireIdentity } from './guards.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import type { ToolArgs } from './schemas.ts';
import { ok, type ToolContext, type ToolOutcome } from './types.ts';

const NOTHING_OWED = 'Nothing is outstanding. Thank them; there is nothing to collect today.';
const CLOSING = "Say these figures once, in the caller's language, then ask when they can pay.";

interface Tone {
  readonly level: ToneLevel;
  readonly consequence: string | null;
}

function overdueLine(dues: Dues): string {
  if (dues.overdueAmount === 0 || dues.oldestDueDate === null) return 'Nothing is overdue yet.';
  return `Overdue: ${formatRupees(dues.overdueAmount)}, due since ` +
    `${formatDay(dues.oldestDueDate)} (${dues.daysOverdue} days).`;
}

function nextDueLine(dues: Dues): string {
  if (dues.nextDueDate === null) return '';
  return ` Next due: ${formatRupees(dues.nextDueAmount)} on ${formatDay(dues.nextDueDate)}.`;
}

function toneLine(tone: Tone): string {
  const line = `Tone level: ${tone.level} (${TONE_NAMES[tone.level]}).`;
  return tone.consequence ? `${line} Consequence set by the owner: ${tone.consequence}` : line;
}

export function describeDues(dues: Dues, memory: string, tone: Tone): string {
  if (dues.outstanding === 0) return NOTHING_OWED;
  const figures = `Total outstanding: ${formatRupees(dues.outstanding)}. ${overdueLine(dues)}` +
    nextDueLine(dues);
  return [figures, memory, toneLine(tone), CLOSING].filter((part) => part !== '').join(' ');
}

async function saveChecks(
  ctx: ToolContext,
  changes: readonly PromiseChange[],
  level: ToneLevel,
): Promise<void> {
  await Promise.all([
    ...changes.map((change) => ctx.repo.setPromiseStatus(change.id, change.status)),
    ctx.repo.setCallToneLevel(ctx.session.callId, level),
  ]);
}

interface Assessment {
  readonly dues: Dues;
  readonly promises: readonly PromiseRecord[];
  readonly changes: readonly PromiseChange[];
  readonly tone: Tone;
}

/** Promise check first, so a promise that broke today already counts towards the tone. */
function assess(
  history: {
    entries: readonly LedgerEntry[];
    stored: readonly PromiseRecord[];
    ownerText: string | null;
  },
  today: string,
): Assessment {
  const changes = checkPromises(history.stored, history.entries, today);
  const promises = applyPromiseChanges(history.stored, changes);
  const dues = computeDues(history.entries, today);
  const level = toneLevel({
    brokenPromises: countRecentBroken(promises, today),
    daysOverdue: dues.daysOverdue,
  });
  return {
    dues,
    promises,
    changes,
    tone: { level, consequence: consequenceFor(level, history.ownerText) },
  };
}

export async function getDues(
  ctx: ToolContext,
  _args: ToolArgs<'get_dues'>,
): Promise<ToolOutcome> {
  const refusal = requireIdentity(ctx.session);
  if (refusal) return refusal;

  const { shopkeeperId } = ctx.session;
  const today = istDate(ctx.now);
  const [entries, stored, shopkeeper] = await Promise.all([
    ctx.repo.getLedger(shopkeeperId),
    ctx.repo.listPromises(shopkeeperId),
    ctx.repo.getShopkeeper(shopkeeperId),
  ]);
  const ownerText = shopkeeper?.consequenceText ?? null;
  const { dues, promises, changes, tone } = assess({ entries, stored, ownerText }, today);
  await saveChecks(ctx, changes, tone.level);

  const memory = buildMemory({ promises, entries, today });
  return ok(describeDues(dues, describeMemory(memory), tone), {
    outstanding: dues.outstanding,
    overdue_amount: dues.overdueAmount,
    oldest_due_date: dues.oldestDueDate,
    days_overdue: dues.daysOverdue,
    next_due_date: dues.nextDueDate,
    next_due_amount: dues.nextDueAmount,
    ...memoryData(memory),
    tone_level: tone.level,
    consequence: tone.consequence,
  });
}
