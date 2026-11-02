// web/src/lib/callsApi.ts
// Browser client for the calls-api Edge Function. Responses are validated with Zod; a blocked
// call returns the server's catalogue message (safe to show) instead of throwing.
import { z } from 'zod';
import { LanguageSchema } from '@shared/schemas/customer.ts';
import { REGION_HEADER } from '@shared/region.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const LIST_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 800;

const CustomerOptionSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  language: LanguageSchema,
  city: z.string(),
});

const CustomersResponseSchema = z.object({ customers: z.array(CustomerOptionSchema) });

const AuthorisedCallSchema = z.object({
  callToken: z.uuid(),
  customerName: z.string(),
  language: LanguageSchema,
  today: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type CustomerOption = z.infer<typeof CustomerOptionSchema>;
export type AuthorisedCall = z.infer<typeof AuthorisedCallSchema>;

export type AuthoriseResult =
  | { readonly ok: true; readonly call: AuthorisedCall }
  | { readonly ok: false; readonly message: string };

export interface CallsApi {
  listCustomers: () => Promise<readonly CustomerOption[]>;
  authoriseCall: (customerId: string) => Promise<AuthoriseResult>;
}

export interface CallsApiOptions {
  readonly baseUrl: string;
  readonly anonKey: string;
  /** Supabase region to run calls-api in (ADR-0008); omitted means nearest to the browser. */
  readonly region?: string;
  readonly fetchImpl?: typeof fetch;
  /** Pause between attempts when loading customers; tests pass 0. */
  readonly retryDelayMs?: number;
}

export class CallsApiError extends Error {
  override name = 'CallsApiError';
}

function wait(ms: number): Promise<void> {
  return new Promise(function resolveLater(resolve) {
    setTimeout(resolve, ms);
  });
}

export function createCallsApi({
  baseUrl,
  anonKey,
  region,
  fetchImpl = fetch,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: CallsApiOptions): CallsApi {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(region ? { [REGION_HEADER]: region } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function fetchCustomers(): Promise<readonly CustomerOption[]> {
    const response = await request('/v1/customers');
    if (!response.ok) throw new CallsApiError(`Customer list failed (${response.status})`);
    return CustomersResponseSchema.parse(await response.json()).customers;
  }

  /** A read with no side effects, so it is safe to retry: the India → Oregon route sometimes
   * drops a connection. Authorising a call is never retried (it creates a call record). */
  async function listCustomers(): Promise<readonly CustomerOption[]> {
    for (let attempt = 1; attempt < LIST_ATTEMPTS; attempt += 1) {
      try {
        return await fetchCustomers();
      } catch {
        await wait(retryDelayMs); // Transient failure: pause, then the next attempt.
      }
    }
    return fetchCustomers();
  }

  async function authoriseCall(customerId: string): Promise<AuthoriseResult> {
    const response = await request('/v1/calls/authorize', {
      method: 'POST',
      body: JSON.stringify({ customerId }),
    });
    const body: unknown = await response.json();
    if (response.ok) return { ok: true, call: AuthorisedCallSchema.parse(body) };
    const refusal = ErrorResponseSchema.safeParse(body);
    if (!refusal.success) throw new CallsApiError(`Authorise failed (${response.status})`);
    return { ok: false, message: refusal.data.error.message };
  }

  return { listCustomers, authoriseCall };
}
