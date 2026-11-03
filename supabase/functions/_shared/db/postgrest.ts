// supabase/functions/_shared/db/postgrest.ts
// Minimal client for Supabase's database HTTP API (PostgREST), replacing supabase-js: less code
// to load when an idle function wakes up (the M2 voice test saw ~2 s cold starts mid-call).
import type { ServerEnv } from '../env.ts';

/** Database calls run inside one region; anything slower than this is a fault, not load. */
const DB_TIMEOUT_MS = 5_000;

/** Postgres unique-violation code: a database rule (e.g. one promise per call) said no. */
export const UNIQUE_VIOLATION = '23505';

export class RepositoryError extends Error {
  override name = 'RepositoryError';
  /** Postgres / PostgREST error code (or "HTTP <status>"); never the database message. */
  readonly code: string;

  constructor(operation: string, code: string) {
    super(`${operation} failed (${code})`);
    this.code = code;
  }
}

export interface PostgrestRequest {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'HEAD';
  readonly body?: unknown;
  /** PostgREST Prefer header, e.g. "return=representation" or "count=exact". */
  readonly prefer?: string;
}

export interface PostgrestResponse {
  readonly rows: unknown;
  /** e.g. "0-2/3" or "*\/3"; carries the total when count=exact is requested. */
  readonly contentRange: string | null;
}

/** `operation` names the call in errors; `path` is relative to /rest/v1/. */
export type PostgrestClient = (
  operation: string,
  path: string,
  request?: PostgrestRequest,
) => Promise<PostgrestResponse>;

/** Error code only: Postgres messages can quote row values (personal data), so they never
 * reach logs. */
async function errorCodeOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`; // Body was not JSON; the status is all we have.
  }
}

async function readRows(response: Response, method: string): Promise<unknown> {
  if (method === 'HEAD') return null;
  const text = await response.text();
  return text === '' ? null : JSON.parse(text);
}

export function createPostgrestClient(
  env: ServerEnv,
  fetchImpl: typeof fetch = fetch,
): PostgrestClient {
  const baseUrl = `${env.SUPABASE_URL}/rest/v1/`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  return async function query(operation, path, request = {}): Promise<PostgrestResponse> {
    const method = request.method ?? 'GET';
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (request.prefer) headers['Prefer'] = request.prefer;
    const response = await fetchImpl(baseUrl + path, {
      method,
      headers,
      body: request.body === undefined ? null : JSON.stringify(request.body),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new RepositoryError(operation, await errorCodeOf(response));
    }
    return {
      rows: await readRows(response, method),
      contentRange: response.headers.get('content-range'),
    };
  };
}

export interface RowInserter {
  /** One row in, nothing back. */
  insert(operation: string, table: string, body: object): Promise<void>;
  /** As insert, but false when a database "one per call" rule rejected the row. */
  insertOnce(operation: string, table: string, body: object): Promise<boolean>;
}

export function createRowInserter(query: PostgrestClient): RowInserter {
  async function insert(operation: string, table: string, body: object): Promise<void> {
    await query(operation, table, { method: 'POST', body, prefer: 'return=minimal' });
  }
  async function insertOnce(operation: string, table: string, body: object): Promise<boolean> {
    try {
      await insert(operation, table, body);
      return true;
    } catch (error) {
      if (error instanceof RepositoryError && error.code === UNIQUE_VIOLATION) return false;
      throw error;
    }
  }
  return { insert, insertOnce };
}
