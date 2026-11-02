// supabase/functions/_shared/db/fake-repository.ts
// In-memory Repository for tests. FAKE DATA ONLY (mirrors two seeded borrowers).
import type { Loan } from '../schemas/loan.ts';
import type {
  CallSession,
  CustomerForCall,
  DemoSettings,
  NewCall,
  NewHandoff,
  NewPromise,
  NewToolEvent,
  Repository,
} from './repository.ts';

export interface FakeCustomer extends CustomerForCall {
  readonly dob: string;
  readonly phoneMasked: string;
}

export interface FakeCall extends NewCall {
  readonly id: string;
  readonly vapiCallId: string | null;
  readonly verified: boolean;
  readonly verifyAttempts: number;
  readonly startedAt: string;
}

export interface FakeState {
  customers: readonly FakeCustomer[];
  loans: readonly Loan[];
  calls: readonly FakeCall[];
  promises: readonly NewPromise[];
  handoffs: readonly NewHandoff[];
  toolEvents: readonly NewToolEvent[];
  settings: DemoSettings;
}

export const FAKE_RAVI: FakeCustomer = {
  id: 'c0000000-0000-4000-8000-000000000001',
  fullName: 'Ravi Sharma',
  dob: '1988-04-12',
  phoneMasked: '+91 98XXXXXX21',
  language: 'hi',
  city: 'Pune',
  doNotCall: false,
};

export const FAKE_ANITA: FakeCustomer = {
  id: 'c0000000-0000-4000-8000-000000000002',
  fullName: 'Anita Desai',
  dob: '1991-09-03',
  phoneMasked: '+91 97XXXXXX45',
  language: 'en',
  city: 'Mumbai',
  doNotCall: false,
};

export const FAKE_LOANS: readonly Loan[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    customer_id: FAKE_RAVI.id,
    loan_number: 'SF-PL-100234',
    product: 'personal_loan',
    emi_amount: 4200,
    due_date: '2026-10-05',
    overdue_amount: 4200,
    days_past_due: 26,
    late_fee: 500,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    customer_id: FAKE_ANITA.id,
    loan_number: 'SF-PL-100871',
    product: 'personal_loan',
    emi_amount: 6500,
    due_date: '2026-10-10',
    overdue_amount: 6500,
    days_past_due: 21,
    late_fee: 500,
  },
];

/** A call row for tests; defaults to a fresh, unclaimed, unverified call for Anita. */
export function fakeCall(overrides: Partial<FakeCall> = {}): FakeCall {
  return {
    id: 'ca000000-0000-4000-8000-0000000000aa',
    customerId: FAKE_ANITA.id,
    language: 'en',
    attemptNo: 1,
    vapiCallId: null,
    verified: false,
    verifyAttempts: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function initialState(overrides: Partial<FakeState>): FakeState {
  return {
    customers: [FAKE_RAVI, FAKE_ANITA],
    loans: FAKE_LOANS,
    calls: [],
    promises: [],
    handoffs: [],
    toolEvents: [],
    settings: { demoClock: null, callingHoursEnabled: false, callLimitsEnabled: false },
    ...overrides,
  };
}

function toSession(call: FakeCall, customer: FakeCustomer): CallSession {
  return {
    callId: call.id,
    customerId: call.customerId,
    customerDob: customer.dob,
    phoneMasked: customer.phoneMasked,
    language: call.language,
    vapiCallId: call.vapiCallId,
    verified: call.verified,
    verifyAttempts: call.verifyAttempts,
    authorizedAt: call.startedAt,
  };
}

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeRepository(overrides: Partial<FakeState> = {}): {
  readonly repo: Repository;
  readonly state: FakeState;
} {
  const state = initialState(overrides);
  const findCustomer = (id: string): FakeCustomer | undefined =>
    state.customers.find((customer) => customer.id === id);
  const findCall = (id: string): FakeCall | undefined => state.calls.find((call) => call.id === id);
  const updateCall = (id: string, patch: Partial<FakeCall>): void => {
    state.calls = state.calls.map((call) => (call.id === id ? { ...call, ...patch } : call));
  };

  const repo: Repository = {
    listCustomers: () =>
      Promise.resolve(
        state.customers.map(({ id, fullName, language, city }) => ({
          id,
          fullName,
          language,
          city,
        })),
      ),
    getCustomerForCall: (id) => Promise.resolve(findCustomer(id) ?? null),
    getDemoSettings: () => Promise.resolve(state.settings),
    countCallsSince: (customerId, since) =>
      Promise.resolve(
        state.calls.filter(
          (call) => call.customerId === customerId && Date.parse(call.startedAt) >= since.getTime(),
        ).length,
      ),
    createCall: (call) => {
      const created = fakeCall({ ...call, id: crypto.randomUUID() });
      state.calls = [...state.calls, created];
      return Promise.resolve(created.id);
    },
    getCallSession: (callId) => {
      const call = findCall(callId);
      const customer = call && findCustomer(call.customerId);
      return Promise.resolve(call && customer ? toSession(call, customer) : null);
    },
    claimCall: (callId, vapiCallId) => {
      if (findCall(callId)?.vapiCallId !== null) return Promise.resolve(false);
      updateCall(callId, { vapiCallId });
      return Promise.resolve(true);
    },
    recordVerification: (callId, verification) => {
      updateCall(callId, verification);
      return Promise.resolve();
    },
    getLoanForCustomer: (customerId) =>
      Promise.resolve(state.loans.find((loan) => loan.customer_id === customerId) ?? null),
    insertPromise: (promise) => {
      state.promises = [...state.promises, promise];
      return Promise.resolve();
    },
    insertHandoff: (handoff) => {
      state.handoffs = [...state.handoffs, handoff];
      return Promise.resolve();
    },
    insertToolEvent: (event) => {
      state.toolEvents = [...state.toolEvents, event];
      return Promise.resolve();
    },
  };
  return { repo, state };
}
