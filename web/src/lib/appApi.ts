// web/src/lib/appApi.ts
// Browser client for calls-api: demo controls, the phone page's ring/accept/decline/ended steps,
// and the headers the Sarvam SDK needs to fetch a call URL through our proxy (the Sarvam key
// never reaches the browser). Responses are validated with Zod; failures become AppApiError with
// a message that is safe to show (the server's catalogue text, or a generic line).
import { z } from 'zod';
import { REGION_HEADER } from '@shared/region.ts';
import { CALL_TOKEN_HEADER, SARVAM_PROXY_PATH } from '@shared/sarvam.ts';
import { LanguageSchema } from '@shared/schemas/shopkeeper.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const CALLS_API_SUFFIX = '/calls-api';
const TOOLS_WARM_PATH = '/sarvam-tools/warm';
const MAX_REPORTED_SECONDS = 3600;
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
export const UNEXPECTED_ERROR = 'The server sent an unexpected reply. Please try again.';

const DemoSchema = z.object({
  liveShopkeeper: z.object({ name: z.string(), shopName: z.string() }).nullable(),
});
const RingSchema = z.object({ status: z.literal('queued'), alreadyQueued: z.boolean() });
const IncomingSchema = z.object({
  call: z.object({ callToken: z.uuid(), callerName: z.string() }).nullable(),
});
const AcceptedSchema = z.object({
  callToken: z.uuid(),
  language: LanguageSchema,
  shopkeeperName: z.string(),
  shopName: z.string(),
  ownerName: z.string(),
  businessName: z.string(),
  today: z.string(),
  sarvam: z.object({ orgId: z.string(), workspaceId: z.string(), appId: z.string() }),
});
const DoneSchema = z.object({ status: z.string() });
const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type DemoInfo = z.infer<typeof DemoSchema>;
export type IncomingCall = NonNullable<z.infer<typeof IncomingSchema>['call']>;
export type AcceptedCall = z.infer<typeof AcceptedSchema>;

export interface EndedReport {
  readonly interactionId: string | null;
  readonly seconds: number;
}

export interface SarvamProxy {
  /** SDK baseUrl: ends with '/', the SDK appends orgs/{org}/workspaces/{ws}/apps/{app}/url. */
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface AppApi {
  getDemo: () => Promise<DemoInfo>;
  ring: () => Promise<{ readonly alreadyQueued: boolean }>;
  incoming: () => Promise<IncomingCall | null>;
  accept: (callToken: string) => Promise<AcceptedCall>;
  decline: (callToken: string) => Promise<void>;
  ended: (callToken: string, report: EndedReport) => Promise<void>;
  sarvamProxy: (callToken: string) => SarvamProxy;
  /** Wakes Asha's tool server while the phone rings, so her first tool call is not a cold start. */
  warmTools: () => void;
}

export interface AppApiOptions {
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly region: string;
  readonly fetchImpl?: typeof fetch;
}

export class AppApiError extends Error {
  override name = 'AppApiError';
  constructor(
    message: string,
    /** Server error code (e.g. CALL_STATE_CONFLICT), or null for network/format problems. */
    readonly code: string | null,
  ) {
    super(message);
  }
}

async function toApiError(response: Response): Promise<AppApiError> {
  const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  return body.success
    ? new AppApiError(body.data.error.message, body.data.error.code)
    : new AppApiError(UNEXPECTED_ERROR, null);
}

/** Opaque GET to sarvam-tools/warm: no reply is read, so no CORS headers are needed. Failures
 * don't matter (the call still works; the first tool call may just be slower). */
function warmTools(callsApiUrl: string, fetchImpl: typeof fetch): void {
  const functionsBase = callsApiUrl.endsWith(CALLS_API_SUFFIX)
    ? callsApiUrl.slice(0, -CALLS_API_SUFFIX.length)
    : callsApiUrl;
  void fetchImpl(`${functionsBase}${TOOLS_WARM_PATH}`, { mode: 'no-cors' }).catch(() => null);
}

export function createAppApi(options: AppApiOptions): AppApi {
  const { baseUrl, anonKey, region, fetchImpl = fetch } = options;
  const baseHeaders = {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    [REGION_HEADER]: region,
  };

  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = { ...baseHeaders, 'Content-Type': 'application/json' };
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, signal }).catch(
      () => null,
    );
    if (!response) throw new AppApiError(NETWORK_ERROR, null);
    if (!response.ok) throw await toApiError(response);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppApiError(UNEXPECTED_ERROR, null);
    return parsed.data;
  }

  function post<T>(path: string, schema: z.ZodType<T>, body: unknown = {}): Promise<T> {
    return call(path, schema, { method: 'POST', body: JSON.stringify(body) });
  }

  const callPath = (token: string, step: string): string =>
    `/v1/calls/${encodeURIComponent(token)}/${step}`;

  return {
    getDemo: () => call('/v1/demo', DemoSchema),
    ring: () => post('/v1/demo/ring', RingSchema),
    incoming: async () => (await call('/v1/phone/incoming', IncomingSchema)).call,
    accept: (token) => post(callPath(token, 'accept'), AcceptedSchema),
    decline: async (token) => {
      await post(callPath(token, 'decline'), DoneSchema);
    },
    ended: async (token, report) => {
      const body = {
        seconds: Math.min(MAX_REPORTED_SECONDS, Math.max(0, Math.round(report.seconds))),
        ...(report.interactionId ? { interactionId: report.interactionId } : {}),
      };
      await post(callPath(token, 'ended'), DoneSchema, body);
    },
    warmTools: () => warmTools(baseUrl, fetchImpl),
    sarvamProxy: (token) => ({
      baseUrl: `${baseUrl}${SARVAM_PROXY_PATH}`,
      headers: { ...baseHeaders, [CALL_TOKEN_HEADER]: token },
    }),
  };
}
