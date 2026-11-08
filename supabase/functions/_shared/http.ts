// supabase/functions/_shared/http.ts
// Response helpers shared by the Edge Functions. Clients only ever see catalogue messages.
import { type ErrorCode, toClientError } from './errors.ts';
import type { Logger } from './log.ts';

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

export function errorResponse(code: ErrorCode, headers: HeadersInit = {}): Response {
  const { status, message } = toClientError(code);
  return jsonResponse({ error: { code, message } }, status, headers);
}

/** What follows `prefix` in the request path, e.g. the tool name after "/sarvam-tools/";
 * '' when the prefix is not in the path. */
export function pathAfter(req: Request, prefix: string): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(prefix);
  return start === -1 ? '' : pathname.slice(start + prefix.length);
}

/** Request JSON body, or null when it is not valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null; // Malformed JSON is a client error; callers answer 400.
  }
}

function describeError(error: unknown): string {
  // Error messages here are ours (RepositoryError, Zod) and carry no row values.
  return error instanceof Error ? `${error.name}: ${error.message}` : 'non-error thrown';
}

/** Last line of defence: log the detail server-side, return a generic 500. */
export async function withErrorBoundary(
  handle: () => Promise<Response>,
  log: Logger,
  headers: HeadersInit = {},
): Promise<Response> {
  try {
    return await handle();
  } catch (error) {
    log('error', 'unhandled_error', { error: describeError(error) });
    return errorResponse('INTERNAL', headers);
  }
}
