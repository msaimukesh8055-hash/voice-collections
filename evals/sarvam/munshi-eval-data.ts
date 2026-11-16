// evals/sarvam/munshi-eval-data.ts
// The database rows one Munshi case needs on Sarvam Tests (M9 Build F). Sarvam calls our real
// tool server, so each case gets its own flagged eval owner (is_eval, eval_agent 'munshi', one
// eval_run per run) holding a fresh copy of the text evals' fake book (evals/munshi/
// book.fixture.ts), plus one live owner-call token. Every fixture id is replaced by a new one, so
// fifteen copies can sit side by side; the map is kept to translate the expected outcome. Dates
// stay as in the fixture. Past Asha calls are stored as completed with their follow-up already
// done, so no worker job ever picks them up. Nothing here touches an existing row.
import {
  EVAL_ENTRIES,
  EVAL_PAST_CALLS,
  EVAL_PROMISES,
  EVAL_SHOPKEEPERS,
} from '../munshi/book.fixture.ts';
import type { ExpectedOutcome } from '../munshi/types.ts';
import { EVAL_CITY } from './eval-data.ts';
import type { MunshiCase } from './munshi-cases.ts';

const EVAL_PHONE = '+91 00000 00000';
/** How long the owner-call link would stay valid (the tools use the 10-minute accept window). */
const LINK_MS = 30 * 60 * 1000;

export interface MunshiCaseRows {
  readonly ownerId: string;
  /** The owner-call token Sarvam passes to every tool call. */
  readonly ownerCallId: string;
  /** Fixture id → this case's id. */
  readonly ids: ReadonlyMap<string, string>;
}

export interface MunshiEvalRows {
  readonly owners: readonly Record<string, unknown>[];
  readonly shopkeepers: readonly Record<string, unknown>[];
  readonly calls: readonly Record<string, unknown>[];
  readonly entries: readonly Record<string, unknown>[];
  readonly promises: readonly Record<string, unknown>[];
  readonly followups: readonly Record<string, unknown>[];
  readonly ownerCalls: readonly Record<string, unknown>[];
  readonly byCase: ReadonlyMap<string, MunshiCaseRows>;
}

export interface MunshiDataOptions {
  readonly now: Date;
  readonly newId: () => string;
  /** One label for the whole run, stored on every eval owner (eval_run). */
  readonly runLabel: string;
  readonly owner: { readonly name: string; readonly businessName: string };
}

type Rows = Omit<MunshiEvalRows, 'byCase'>;

function idMap(newId: () => string): Map<string, string> {
  const ids = new Map<string, string>();
  const fixtureIds = [
    ...EVAL_SHOPKEEPERS.map((shop) => shop.id),
    ...EVAL_ENTRIES.map((entry) => entry.id),
    ...EVAL_PROMISES.map((promise) => promise.id),
    ...EVAL_PAST_CALLS.map((call) => call.id),
  ];
  for (const fixtureId of fixtureIds) ids.set(fixtureId, newId());
  return ids;
}

function mapped(ids: ReadonlyMap<string, string>, fixtureId: string): string {
  const id = ids.get(fixtureId);
  if (!id) throw new Error(`fixture id ${fixtureId} has no eval copy`);
  return id;
}

/** The past Asha call a claim entry was made on (same shopkeeper, amount and date). */
function claimCallOf(entry: (typeof EVAL_ENTRIES)[number]): string | null {
  const call = EVAL_PAST_CALLS.find(
    (past) =>
      past.shopkeeperId === entry.shopkeeperId &&
      past.claims.some(
        (claim) => claim.amount === entry.amount && claim.paidDate === entry.entryDate,
      ),
  );
  return entry.status === 'claimed' && call ? call.id : null;
}

type To = (fixtureId: string) => string;
type Row = Record<string, unknown>;

function shopkeeperRows(ownerId: string, to: To): Row[] {
  return EVAL_SHOPKEEPERS.map((shop) => ({
    id: to(shop.id),
    owner_id: ownerId,
    name: shop.name,
    shop_name: shop.shopName,
    area: shop.area,
    phone: EVAL_PHONE,
    language: shop.language,
  }));
}

function pastCallRows(to: To): Row[] {
  return EVAL_PAST_CALLS.map((call) => ({
    id: to(call.id),
    shopkeeper_id: to(call.shopkeeperId),
    mode: call.mode,
    status: call.status,
    identity_status: call.identityStatus,
    language: 'te',
    queued_at: call.queuedAt,
    ended_at: call.queuedAt,
    followup_status: 'done',
  }));
}

function entryRows(to: To): Row[] {
  return EVAL_ENTRIES.map((entry) => {
    const callId = claimCallOf(entry);
    return {
      id: to(entry.id),
      shopkeeper_id: to(entry.shopkeeperId),
      kind: entry.kind,
      amount: entry.amount,
      entry_date: entry.entryDate,
      due_date: entry.dueDate,
      status: entry.status,
      payment_mode: entry.paymentMode,
      source: callId ? 'call' : 'seed',
      call_id: callId ? to(callId) : null,
      created_at: entry.createdAt,
    };
  });
}

function promiseRows(to: To): Row[] {
  return EVAL_PROMISES.map((promise) => {
    const call = EVAL_PAST_CALLS.find((past) => past.promises.some((p) => p.id === promise.id));
    return {
      id: to(promise.id),
      shopkeeper_id: to(promise.shopkeeperId),
      call_id: call ? to(call.id) : null,
      amount: promise.amount,
      promise_date: promise.promiseDate,
      status: promise.status,
      created_at: promise.createdAt,
    };
  });
}

function followupRows(to: To): Row[] {
  return EVAL_PAST_CALLS.flatMap((call) =>
    call.followups.map((followup) => ({
      shopkeeper_id: to(call.shopkeeperId),
      call_id: to(call.id),
      kind: followup.kind,
      reason: followup.reason,
      summary: followup.summary,
      status: 'done',
    })),
  );
}

function bookRows(
  ownerId: string,
  ids: ReadonlyMap<string, string>,
): Omit<Rows, 'owners' | 'ownerCalls'> {
  const to: To = (fixtureId) => mapped(ids, fixtureId);
  return {
    shopkeepers: shopkeeperRows(ownerId, to),
    calls: pastCallRows(to),
    entries: entryRows(to),
    promises: promiseRows(to),
    followups: followupRows(to),
  };
}

export function buildMunshiEvalRows(
  cases: readonly MunshiCase[],
  options: MunshiDataOptions,
): MunshiEvalRows {
  const byCase = new Map<string, MunshiCaseRows>();
  const all: { [K in keyof Rows]: Record<string, unknown>[] } = {
    owners: [],
    shopkeepers: [],
    calls: [],
    entries: [],
    promises: [],
    followups: [],
    ownerCalls: [],
  };
  for (const evalCase of cases) {
    const ownerId = options.newId();
    const ownerCallId = options.newId();
    const ids = idMap(options.newId);
    byCase.set(evalCase.id, { ownerId, ownerCallId, ids });
    all.owners.push({
      id: ownerId,
      name: options.owner.name,
      business_name: options.owner.businessName,
      city: EVAL_CITY,
      language: 'te',
      is_eval: true,
      eval_agent: 'munshi',
      eval_run: options.runLabel,
    });
    const book = bookRows(ownerId, ids);
    for (const key of ['shopkeepers', 'calls', 'entries', 'promises', 'followups'] as const) {
      all[key].push(...book[key]);
    }
    const acceptedAt = new Date(options.now.getTime() - evalCase.acceptedAgoMs);
    all.ownerCalls.push({
      id: ownerCallId,
      owner_id: ownerId,
      status: 'accepted',
      issued_at: acceptedAt.toISOString(),
      accepted_at: acceptedAt.toISOString(),
      expires_at: new Date(acceptedAt.getTime() + LINK_MS).toISOString(),
    });
  }
  return { ...all, byCase };
}

/** The expected outcome in this case's ids. */
export function outcomeFor(
  outcome: ExpectedOutcome,
  ids: ReadonlyMap<string, string>,
): ExpectedOutcome {
  const to = (fixtureId: string): string => mapped(ids, fixtureId);
  return {
    ...(outcome.entries
      ? {
          entries: outcome.entries.map((entry) => ({
            ...entry,
            shopkeeperId: to(entry.shopkeeperId),
          })),
        }
      : {}),
    ...(outcome.reversed ? { reversed: outcome.reversed.map(to) } : {}),
    ...(outcome.claims
      ? {
          claims: Object.fromEntries(
            Object.entries(outcome.claims).map(([claimId, settled]) => [to(claimId), settled]),
          ),
        }
      : {}),
    ...(outcome.reminders ? { reminders: outcome.reminders.map(to) } : {}),
    ...(outcome.sends ? { sends: outcome.sends } : {}),
  };
}
