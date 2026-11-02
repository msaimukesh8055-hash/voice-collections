// supabase/functions/_shared/db/supabase-repository.ts
// Repository backed by Supabase Postgres through its HTTP API (service role; RLS blocks the
// browser). Every row read is parsed with Zod, so a schema drift fails loudly here instead of
// deep inside a tool. Ids reaching query strings are UUIDs validated upstream, and still encoded.
import { z } from 'zod';
import { LanguageSchema } from '../schemas/customer.ts';
import { type Loan, LoanSchema } from '../schemas/loan.ts';
import { type PostgrestClient, RepositoryError } from './postgrest.ts';
import type {
  CallSession,
  CustomerForCall,
  CustomerSummary,
  DemoSettings,
  Repository,
} from './repository.ts';

const CUSTOMER_LIST_LIMIT = 50;
const CUSTOMER_COLUMNS = 'id,full_name,preferred_language,city,do_not_call';
const SESSION_COLUMNS = 'id,customer_id,language,vapi_call_id,verified,verify_attempts,' +
  'started_at,customers(dob,phone_masked)';
const LOAN_COLUMNS = 'id,customer_id,loan_number,product,emi_amount,due_date,overdue_amount,' +
  'days_past_due,late_fee';
const SETTINGS_COLUMNS = 'demo_clock,calling_hours_enabled,call_limits_enabled';

const CustomerRow = z.object({
  id: z.uuid(),
  full_name: z.string(),
  preferred_language: LanguageSchema,
  city: z.string(),
  do_not_call: z.boolean(),
});

const SessionRow = z.object({
  id: z.uuid(),
  customer_id: z.uuid(),
  language: LanguageSchema,
  vapi_call_id: z.string().nullable(),
  verified: z.boolean(),
  verify_attempts: z.number().int(),
  started_at: z.string(),
  customers: z.object({ dob: z.iso.date(), phone_masked: z.string() }),
});

const SettingsRow = z.object({
  demo_clock: z.string().nullable(),
  calling_hours_enabled: z.boolean(),
  call_limits_enabled: z.boolean(),
});

const IdRow = z.object({ id: z.uuid() });

const AttemptsRow = z.object({ verify_attempts: z.number().int().min(0) });

const id = encodeURIComponent;

/** First row of a list response, or null. */
function firstRow<T>(schema: z.ZodType<T>, rows: unknown): T | null {
  return z.array(schema).parse(rows)[0] ?? null;
}

/** Total from a Content-Range header such as "0-2/3" or "*\/3". */
function totalFrom(contentRange: string | null): number {
  const total = Number(contentRange?.split('/')[1]);
  if (!Number.isInteger(total)) throw new RepositoryError('countCallsSince failed (no count)');
  return total;
}

function toCustomer(row: z.infer<typeof CustomerRow>): CustomerForCall {
  return {
    id: row.id,
    fullName: row.full_name,
    language: row.preferred_language,
    city: row.city,
    doNotCall: row.do_not_call,
  };
}

function toSession(row: z.infer<typeof SessionRow>): CallSession {
  return {
    callId: row.id,
    customerId: row.customer_id,
    customerDob: row.customers.dob,
    phoneMasked: row.customers.phone_masked,
    language: row.language,
    vapiCallId: row.vapi_call_id,
    verified: row.verified,
    verifyAttempts: row.verify_attempts,
    authorizedAt: row.started_at,
  };
}

function customerQueries(
  query: PostgrestClient,
): Pick<Repository, 'listCustomers' | 'getCustomerForCall'> {
  return {
    async listCustomers(): Promise<readonly CustomerSummary[]> {
      const path =
        `customers?select=${CUSTOMER_COLUMNS}&order=full_name&limit=${CUSTOMER_LIST_LIMIT}`;
      const { rows } = await query('listCustomers', path);
      return z.array(CustomerRow).parse(rows).map((row) => {
        const { doNotCall: _hidden, ...summary } = toCustomer(row);
        return summary;
      });
    },
    async getCustomerForCall(customerId): Promise<CustomerForCall | null> {
      const path = `customers?select=${CUSTOMER_COLUMNS}&id=eq.${id(customerId)}`;
      const row = firstRow(CustomerRow, (await query('getCustomerForCall', path)).rows);
      return row && toCustomer(row);
    },
  };
}

function settingsAndCounts(
  query: PostgrestClient,
): Pick<Repository, 'getDemoSettings' | 'countCallsSince' | 'createCall'> {
  return {
    async getDemoSettings(): Promise<DemoSettings> {
      const path = `demo_settings?select=${SETTINGS_COLUMNS}&id=eq.1`;
      const row = firstRow(SettingsRow, (await query('getDemoSettings', path)).rows);
      return {
        demoClock: row?.demo_clock ?? null,
        callingHoursEnabled: row?.calling_hours_enabled ?? false,
        callLimitsEnabled: row?.call_limits_enabled ?? false,
      };
    },
    async countCallsSince(customerId, since): Promise<number> {
      const path = `calls?select=id&customer_id=eq.${id(customerId)}` +
        `&started_at=gte.${id(since.toISOString())}`;
      const request = { method: 'HEAD', prefer: 'count=exact' } as const;
      return totalFrom((await query('countCallsSince', path, request)).contentRange);
    },
    async createCall(call): Promise<string> {
      const body = {
        customer_id: call.customerId,
        language: call.language,
        attempt_no: call.attemptNo,
      };
      const request = { method: 'POST', body, prefer: 'return=representation' } as const;
      const row = firstRow(IdRow, (await query('createCall', 'calls?select=id', request)).rows);
      if (!row) throw new RepositoryError('createCall failed (no row)');
      return row.id;
    },
  };
}

function callQueries(
  query: PostgrestClient,
): Pick<
  Repository,
  | 'getCallSession'
  | 'claimCall'
  | 'recordVerification'
  | 'countFailedVerifyAttemptsSince'
  | 'getLoanForCustomer'
> {
  return {
    async getCallSession(callId): Promise<CallSession | null> {
      const path = `calls?select=${SESSION_COLUMNS}&id=eq.${id(callId)}`;
      const row = firstRow(SessionRow, (await query('getCallSession', path)).rows);
      return row && toSession(row);
    },
    async claimCall(callId, vapiCallId): Promise<boolean> {
      // Conditional update: only succeeds while no Vapi call holds the token (no race window).
      const path = `calls?id=eq.${id(callId)}&vapi_call_id=is.null&select=id`;
      const body = { vapi_call_id: vapiCallId };
      const request = { method: 'PATCH', body, prefer: 'return=representation' } as const;
      return z.array(IdRow).parse((await query('claimCall', path, request)).rows).length === 1;
    },
    async recordVerification(callId, { verified, verifyAttempts }): Promise<boolean> {
      // Compare-and-set on the attempt count, like claimCall: parallel requests can't both win.
      const path = `calls?id=eq.${id(callId)}&verify_attempts=eq.${verifyAttempts - 1}&select=id`;
      const body = { verified, verify_attempts: verifyAttempts };
      const request = { method: 'PATCH', body, prefer: 'return=representation' } as const;
      const { rows } = await query('recordVerification', path, request);
      return z.array(IdRow).parse(rows).length === 1;
    },
    async countFailedVerifyAttemptsSince(customerId, since): Promise<number> {
      const path = `calls?select=verify_attempts&customer_id=eq.${id(customerId)}` +
        `&verified=is.false&started_at=gte.${id(since.toISOString())}`;
      const { rows } = await query('countFailedVerifyAttemptsSince', path);
      return z.array(AttemptsRow).parse(rows).reduce((sum, row) => sum + row.verify_attempts, 0);
    },
    async getLoanForCustomer(customerId): Promise<Loan | null> {
      const path = `loans?select=${LOAN_COLUMNS}&customer_id=eq.${id(customerId)}` +
        '&order=days_past_due.desc&limit=1';
      return firstRow(LoanSchema, (await query('getLoanForCustomer', path)).rows);
    },
  };
}

function inserts(
  query: PostgrestClient,
): Pick<Repository, 'insertPromise' | 'insertHandoff' | 'insertToolEvent'> {
  async function insert(operation: string, table: string, body: object): Promise<void> {
    await query(operation, table, { method: 'POST', body, prefer: 'return=minimal' });
  }
  return {
    insertPromise: (promise) =>
      insert('insertPromise', 'promises', {
        call_id: promise.callId,
        loan_id: promise.loanId,
        amount: promise.amount,
        promise_date: promise.promiseDate,
        payment_mode: promise.paymentMode,
      }),
    insertHandoff: (handoff) =>
      insert('insertHandoff', 'handoffs', {
        call_id: handoff.callId,
        customer_id: handoff.customerId,
        reason: handoff.reason,
        summary: handoff.summary,
      }),
    insertToolEvent: (event) =>
      insert('insertToolEvent', 'tool_events', {
        call_id: event.callId,
        tool: event.tool,
        args: event.args,
        result: event.result,
      }),
  };
}

export function createSupabaseRepository(query: PostgrestClient): Repository {
  return {
    ...customerQueries(query),
    ...settingsAndCounts(query),
    ...callQueries(query),
    ...inserts(query),
  };
}
