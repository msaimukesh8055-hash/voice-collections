// supabase/functions/_shared/db/fake-book-repository.ts
// In-memory BookRepository for tests. FAKE DATA ONLY. Ramesh's book mirrors his seeded story on
// FAKE_TODAY (₹8,500 = ₹5,000 overdue since 21 Oct + ₹3,500 due 5 Nov) plus Asha's ₹2,000 claim.
import { FAKE_TODAY } from './fake-repository.ts';
import type {
  ActionStatus,
  BookEntry,
  BookRepository,
  BookShopkeeper,
  LastPromise,
  NewShopkeeper,
  Owner,
  PendingAction,
} from './book-repository.ts';

export { FAKE_TODAY };

export const FAKE_OWNER: Owner = {
  id: '0e000000-0000-4000-8000-000000000001',
  name: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  city: 'Anantapur',
  language: 'te',
};

type ShopkeeperNames = Pick<BookShopkeeper, 'name' | 'shopName'> & { readonly area?: string };

function shopkeeper(n: number, names: ShopkeeperNames): BookShopkeeper {
  return {
    id: `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    area: 'Old Town',
    ...names,
    language: 'te',
  };
}

export const RAMESH = shopkeeper(1, { name: 'Ramesh', shopName: 'Ramesh Kirana' });
export const LATHA = shopkeeper(2, {
  name: 'Latha',
  shopName: 'Latha General Stores',
  area: 'Gandhi Bazaar',
});
export const PRAVEEN_1 = shopkeeper(3, {
  name: 'Praveen',
  shopName: 'Praveen Bakery',
  area: 'Sai Nagar',
});
export const PRAVEEN_2 = shopkeeper(4, {
  name: 'Praveen',
  shopName: 'Praveen Super Market',
  area: 'Ganesh Nagar',
});
export const SURESH = shopkeeper(5, { name: 'Suresh', shopName: 'Suresh Fancy Store' });

export const CLAIM_ID = 'e0000000-0000-4000-8000-0000000000c1';

let entryCounter = 0;
export function bookEntry(
  fields: Partial<BookEntry> & Pick<BookEntry, 'kind' | 'amount'>,
): BookEntry {
  entryCounter += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(entryCounter).padStart(12, '0')}`,
    shopkeeperId: RAMESH.id,
    entryDate: '2026-10-01',
    dueDate: fields.kind === 'credit' ? '2026-10-16' : null,
    status: 'confirmed',
    paymentMode: null,
    createdAt: '2026-10-01T10:00:00Z',
    ...fields,
  };
}

export function fakeBookEntries(): readonly BookEntry[] {
  return [
    bookEntry({ kind: 'credit', amount: 4000, entryDate: '2026-09-05', dueDate: '2026-09-20' }),
    bookEntry({ kind: 'payment', amount: 4000, entryDate: '2026-09-24' }),
    bookEntry({ kind: 'credit', amount: 5000, entryDate: '2026-10-06', dueDate: '2026-10-21' }),
    bookEntry({ kind: 'credit', amount: 3500, entryDate: '2026-10-21', dueDate: '2026-11-05' }),
    bookEntry({
      id: CLAIM_ID,
      kind: 'payment',
      amount: 2000,
      entryDate: '2026-11-01',
      status: 'claimed',
      paymentMode: 'upi',
    }),
    bookEntry({
      shopkeeperId: LATHA.id,
      kind: 'credit',
      amount: 2000,
      entryDate: '2026-10-10',
      dueDate: '2026-10-25',
    }),
    // Praveen (Bakery) paid off a credit this month.
    bookEntry({
      shopkeeperId: PRAVEEN_1.id,
      kind: 'credit',
      amount: 1500,
      entryDate: '2026-10-05',
      dueDate: '2026-10-20',
    }),
    bookEntry({
      shopkeeperId: PRAVEEN_1.id,
      kind: 'payment',
      amount: 1500,
      entryDate: '2026-11-01',
    }),
  ];
}

export interface FakeBookState {
  owner: Owner | null;
  shopkeepers: readonly BookShopkeeper[];
  entries: readonly BookEntry[];
  promises: Readonly<Record<string, LastPromise>>;
  actions: readonly (PendingAction & { readonly payload: unknown })[];
  inbound: readonly {
    waMessageId: string;
    senderHash: string;
    path: string | null;
    command: string | null;
  }[];
  outbound: readonly { waMessageId: string | null; senderHash: string; msgType: string }[];
  strangerReplies: readonly string[];
  newShopkeepers: readonly NewShopkeeper[];
}

function initialState(overrides: Partial<FakeBookState>): FakeBookState {
  return {
    owner: FAKE_OWNER,
    shopkeepers: [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2, SURESH],
    entries: fakeBookEntries(),
    promises: { [RAMESH.id]: { amount: 3000, promiseDate: '2026-10-30', status: 'broken' } },
    actions: [],
    inbound: [],
    outbound: [],
    strangerReplies: [],
    newShopkeepers: [],
    ...overrides,
  };
}

function bookReads(state: FakeBookState): Pick<
  BookRepository,
  'getOwner' | 'listShopkeepers' | 'listEntries' | 'listShopkeeperEntries' | 'getLastPromise'
> {
  return {
    getOwner: () => Promise.resolve(state.owner),
    listShopkeepers: () => Promise.resolve(state.shopkeepers),
    listEntries: () => Promise.resolve(state.entries),
    listShopkeeperEntries: (shopkeeperId) =>
      Promise.resolve(state.entries.filter((entry) => entry.shopkeeperId === shopkeeperId)),
    getLastPromise: (shopkeeperId) => Promise.resolve(state.promises[shopkeeperId] ?? null),
  };
}

function bookWrites(state: FakeBookState): Pick<
  BookRepository,
  'insertShopkeeper' | 'insertEntry' | 'settleClaim'
> {
  return {
    insertShopkeeper: (input) => {
      const created: BookShopkeeper = {
        id: crypto.randomUUID(),
        name: input.name,
        shopName: input.shopName,
        area: input.area,
        language: input.language,
      };
      state.shopkeepers = [...state.shopkeepers, created];
      state.newShopkeepers = [...state.newShopkeepers, input];
      return Promise.resolve(created);
    },
    insertEntry: (input) => {
      const created = bookEntry({
        ...input,
        entryDate: input.entryDate,
        createdAt: new Date().toISOString(),
      });
      state.entries = [...state.entries, created];
      return Promise.resolve(created.id);
    },
    settleClaim: (entryId, status) => {
      const found = state.entries.find((entry) =>
        entry.id === entryId && entry.kind === 'payment' && entry.status === 'claimed'
      );
      if (!found) return Promise.resolve(null);
      const settled = { ...found, status };
      state.entries = state.entries.map((entry) => (entry.id === entryId ? settled : entry));
      return Promise.resolve(settled);
    },
  };
}

function actionStore(state: FakeBookState): Pick<
  BookRepository,
  'createPendingAction' | 'getPendingAction' | 'transitionPendingAction'
> {
  return {
    createPendingAction: (input) => {
      const id = crypto.randomUUID();
      const action = {
        id,
        kind: input.kind,
        payload: input.payload,
        status: 'open' as ActionStatus,
        expiresAt: input.expiresAt,
      };
      state.actions = [...state.actions, action];
      return Promise.resolve(id);
    },
    getPendingAction: (id) =>
      Promise.resolve(state.actions.find((action) => action.id === id) ?? null),
    transitionPendingAction: (id, from, to) => {
      const found = state.actions.find((action) => action.id === id && action.status === from);
      if (!found) return Promise.resolve(false);
      state.actions = state.actions.map((
        action,
      ) => (action.id === id ? { ...action, status: to } : action));
      return Promise.resolve(true);
    },
  };
}

function messageStore(state: FakeBookState): Pick<
  BookRepository,
  'recordInbound' | 'markInboundHandled' | 'recordOutbound' | 'claimStrangerReply'
> {
  return {
    recordInbound: (message) => {
      if (state.inbound.some((row) => row.waMessageId === message.waMessageId)) {
        return Promise.resolve(false);
      }
      const row = {
        waMessageId: message.waMessageId,
        senderHash: message.senderHash,
        path: null,
        command: null,
      };
      state.inbound = [...state.inbound, row];
      return Promise.resolve(true);
    },
    markInboundHandled: (waMessageId, result) => {
      state.inbound = state.inbound.map((row) =>
        row.waMessageId === waMessageId ? { ...row, ...result } : row
      );
      return Promise.resolve();
    },
    recordOutbound: (message) => {
      state.outbound = [...state.outbound, message];
      return Promise.resolve();
    },
    claimStrangerReply: (senderHash, istDay) => {
      const key = `${senderHash}:${istDay}`;
      if (state.strangerReplies.includes(key)) return Promise.resolve(false);
      state.strangerReplies = [...state.strangerReplies, key];
      return Promise.resolve(true);
    },
  };
}

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeBookRepository(overrides: Partial<FakeBookState> = {}): {
  readonly book: BookRepository;
  readonly state: FakeBookState;
} {
  const state = initialState(overrides);
  const book: BookRepository = {
    ...bookReads(state),
    ...bookWrites(state),
    ...actionStore(state),
    ...messageStore(state),
  };
  return { book, state };
}
