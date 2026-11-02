// supabase/functions/_shared/db/postgrest.ts
// Minimal client for Supabase's database HTTP API (PostgREST), replacing supabase-js: less code
// to load when an idle function wakes up (the M2 voice test saw ~2 s cold starts mid-call).
import type { ServerEnv } from '../env.ts';

/** Database calls run inside one region; anything slower than this is a fault, not load. */
const DB_TIMEOUT_MS = 5_000;

export class RepositoryError extends Error {
  override name = 'RepositoryError';
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
      throw new RepositoryError(`${operation} failed (${await errorCodeOf(response)})`);
    }
    return {
      rows: await readRows(response, method),
      contentRange: response.headers.get('content-range'),
    };
  };
}
