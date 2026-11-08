// supabase/functions/_shared/owner-tools/__fixtures__/context.ts
// An owner-tool context on the fake book (FAKE DATA ONLY): Srinivas's owner call on FAKE_TODAY.
// Ramesh owes ₹8,500 (₹5,000 overdue since 21 Oct, ₹3,500 due 5 Nov) and told Asha he paid
// ₹2,000 (a claim, not counted); Latha owes ₹2,000 overdue since 25 Oct. Reads are counted so
// tests can hold each tool to its round-trip budget. Build B: the write side shares the same fake
// book, so a confirmed change shows up in the next read; Remind and the send kick are recorded.
import type { QueueCallResult } from '../../calls/queue-call.ts';
import type { BookEntry, BookRepository, BookShopkeeper } from '../../db/book-repository.ts';
import {
  createFakeBookRepository,
  FAKE_OWNER,
  type FakeBookState,
} from '../../db/fake-book-repository.ts';
import { fakeOwnerCall } from '../../db/fake-owner-call-repository.ts';
import {
  createFakeRepository,
  FAKE_NOW,
  FAKE_TODAY,
  type FakePastCall,
  type FakePromiseRecord,
} from '../../db/fake-repository.ts';
import {
  createFakeVoiceActionRepository,
  type FakeVoiceActionState,
} from '../../db/fake-voice-action-repository.ts';
import type { OwnerCall } from '../../db/owner-call-repository.ts';
import type { VoiceAction } from '../../db/voice-action-repository.ts';
import type { AlertPromise } from '../../ledger/due-alert.ts';
import type { CallStatus } from '../../schemas/shopkeeper.ts';
import type { OwnerReads, OwnerToolContext, OwnerWrites } from '../types.ts';

export interface ContextOptions {
  readonly shopkeepers?: readonly BookShopkeeper[];
  readonly entries?: readonly BookEntry[];
  readonly alertPromises?: readonly AlertPromise[];
  readonly promises?: readonly FakePromiseRecord[];
  readonly pastCalls?: readonly FakePastCall[];
  readonly callStatuses?: Readonly<Record<string, readonly CallStatus[]>>;
  readonly today?: string;
  /** Real time of the tool call (default FAKE_NOW). */
  readonly realNow?: Date;
  readonly actions?: readonly VoiceAction[];
  readonly ownerCall?: OwnerCall;
  readonly queueCall?: (shopkeeperId: string) => Promise<QueueCallResult>;
}

export interface CountedContext {
  readonly ctx: OwnerToolContext;
  /** Read and write calls made, by method name. */
  readonly calls: string[];
  readonly book: FakeBookState;
  readonly actions: FakeVoiceActionState;
  /** Shopkeeper ids Remind queued, and action ids the send kicked. */
  readonly queued: string[];
  readonly kicked: string[];
}

function counted<T extends object>(target: T, calls: string[]): T {
  return new Proxy(target, {
    get(object, key, receiver): unknown {
      const value: unknown = Reflect.get(object, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        calls.push(String(key));
        return Reflect.apply(value, object, args);
      };
    },
  });
}

function readsFor(options: ContextOptions, book: BookRepository, calls: string[]): OwnerReads {
  const { repo } = createFakeRepository({
    promiseHistory: options.promises ?? [],
    pastCalls: options.pastCalls ?? [],
  });
  const alertPromises = options.alertPromises ?? [];
  const statuses = options.callStatuses ?? {};
  return {
    book: counted(book, calls),
    memory: counted(repo, calls),
    alerts: counted({
      listAlertPromises: (_ownerId: string, _since: string): Promise<readonly AlertPromise[]> =>
        Promise.resolve(alertPromises),
    }, calls),
    listCallStatuses: (shopkeeperId: string): Promise<readonly CallStatus[]> => {
      calls.push('listCallStatuses');
      return Promise.resolve(statuses[shopkeeperId] ?? []);
    },
  };
}

function queuedOk(queued: string[]): (shopkeeperId: string) => Promise<QueueCallResult> {
  return (shopkeeperId) => {
    queued.push(shopkeeperId);
    return Promise.resolve({ ok: true, callId: crypto.randomUUID(), alreadyQueued: false });
  };
}

function writesFor(
  options: ContextOptions,
  fakes: { book: BookRepository; actions: OwnerWrites['actions'] },
  record: { calls: string[]; queued: string[]; kicked: string[] },
): OwnerWrites {
  const queueCall = options.queueCall ?? queuedOk(record.queued);
  return {
    actions: counted(fakes.actions, record.calls),
    book: counted(fakes.book, record.calls),
    queueCall: (shopkeeperId) => {
      record.calls.push('queueCall');
      return queueCall(shopkeeperId);
    },
    kickOwnerSend: (actionId) => {
      record.kicked.push(actionId);
    },
  };
}

export function ownerContext(options: ContextOptions = {}): CountedContext {
  const calls: string[] = [];
  const queued: string[] = [];
  const kicked: string[] = [];
  const fakeBook = createFakeBookRepository({
    ...(options.shopkeepers ? { shopkeepers: options.shopkeepers } : {}),
    ...(options.entries ? { entries: options.entries } : {}),
  });
  const fakeActions = createFakeVoiceActionRepository(options.actions ?? []);
  const ctx: OwnerToolContext = {
    reads: readsFor(options, fakeBook.book, calls),
    writes: writesFor(options, { book: fakeBook.book, actions: fakeActions.actions }, {
      calls,
      queued,
      kicked,
    }),
    owner: FAKE_OWNER,
    ownerCall: options.ownerCall ?? fakeOwnerCall(),
    today: options.today ?? FAKE_TODAY,
    realNow: options.realNow ?? FAKE_NOW,
  };
  return { ctx, calls, book: fakeBook.state, actions: fakeActions.state, queued, kicked };
}

/** The same context a little later (same book and actions): the owner's next turn. */
export function later(context: CountedContext, ms: number): CountedContext {
  const realNow = new Date(context.ctx.realNow.getTime() + ms);
  return { ...context, ctx: { ...context.ctx, realNow } };
}
