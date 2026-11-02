// supabase/functions/_shared/db/repository.ts
// Data access contract. Tools and handlers depend on this interface, never on Supabase directly,
// so tests run against the in-memory fake. Latency rule: a tool does at most one read + one write.
import type { Language } from '../schemas/customer.ts';
import type { Loan } from '../schemas/loan.ts';
import type { PAYMENT_MODES } from '../compliance/promise-policy.ts';

export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Everything the webhook knows about a live call; the customer comes from the call token only. */
export interface CallSession {
  readonly callId: string;
  readonly customerId: string;
  readonly customerDob: string;
  readonly phoneMasked: string;
  readonly language: Language;
  readonly vapiCallId: string | null;
  readonly verified: boolean;
  readonly verifyAttempts: number;
  /** When the call token was issued (ISO timestamp). */
  readonly authorizedAt: string;
}

export interface CustomerSummary {
  readonly id: string;
  readonly fullName: string;
  readonly language: Language;
  readonly city: string;
}

export interface CustomerForCall extends CustomerSummary {
  readonly doNotCall: boolean;
}

export interface DemoSettings {
  readonly demoClock: string | null;
  readonly callingHoursEnabled: boolean;
  readonly callLimitsEnabled: boolean;
}

export interface NewCall {
  readonly customerId: string;
  readonly language: Language;
  readonly attemptNo: number;
}

export interface Verification {
  readonly verified: boolean;
  readonly verifyAttempts: number;
}

export interface NewPromise {
  readonly callId: string;
  readonly loanId: string;
  readonly amount: number;
  readonly promiseDate: string;
  readonly paymentMode: PaymentMode;
}

export interface NewHandoff {
  readonly callId: string;
  readonly customerId: string;
  readonly reason: string;
  readonly summary: string;
}

export interface NewToolEvent {
  readonly callId: string;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
}

export interface Repository {
  listCustomers(): Promise<readonly CustomerSummary[]>;
  getCustomerForCall(customerId: string): Promise<CustomerForCall | null>;
  getDemoSettings(): Promise<DemoSettings>;
  countCallsSince(customerId: string, since: Date): Promise<number>;
  createCall(call: NewCall): Promise<string>;
  getCallSession(callId: string): Promise<CallSession | null>;
  /** Binds the token to a Vapi call; false if another Vapi call already holds it. */
  claimCall(callId: string, vapiCallId: string): Promise<boolean>;
  recordVerification(callId: string, verification: Verification): Promise<void>;
  /** The customer's most overdue loan. */
  getLoanForCustomer(customerId: string): Promise<Loan | null>;
  insertPromise(promise: NewPromise): Promise<void>;
  insertHandoff(handoff: NewHandoff): Promise<void>;
  insertToolEvent(event: NewToolEvent): Promise<void>;
}
