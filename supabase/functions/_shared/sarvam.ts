// supabase/functions/_shared/sarvam.ts
// Sarvam Voice Agents constants shared by the functions, the phone page and the agent build
// script (ADR-0012). The runtime URL is Sarvam's public app-runtime API (not a secret).

/** Upstream for the call-URL request; the key goes only here, never to the browser. */
export const SARVAM_RUNTIME_URL = 'https://apps.sarvam.ai/api/app-runtime/';

/** Header the phone page adds to the SDK's one HTTP request, so our proxy knows the call. */
export const CALL_TOKEN_HEADER = 'x-call-token';

/** Agent variable holding the call token; Sarvam puts it in every tool request body. */
export const CALL_TOKEN_VARIABLE = 'call_token';

/** calls-api route prefix the SDK's baseUrl points at (it appends orgs/…/url). */
export const SARVAM_PROXY_PATH = '/v1/sarvam/';

/** Each tool must answer well inside this, or Sarvam speaks its on-failure line. */
export const TOOL_TIMEOUT_SECONDS = 10;
