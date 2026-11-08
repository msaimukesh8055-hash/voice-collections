// web/src/lib/appApi.ts
// Browser client for calls-api: demo controls, the phone page's ring/accept/decline/ended steps,
// the /munshi page's session/accept/ended steps (M8, the signed link token in x-call-token), and
// the headers the Sarvam SDK needs to fetch a call URL through our proxy (the Sarvam key
// never reaches the browser). Responses are validated with Zod; failures become AppApiError with
// a message that is safe to show (the server's catalogue text, or a generic line).
import { z } from 'zod';
import { REGION_HEADER } from '@shared/region.ts';
import { CALL_TOKEN_HEADER, SARVAM_PROXY_PATH } from '@shared/sarvam.ts';
import { LanguageSchema } from '@shared/schemas/shopkeeper.ts';

const REQUEST_TIMEOUT_MS = 10_000;
const CALLS_API_SUFFIX = '/calls-api';
const TOOLS_WARM_PATH = '/sarvam-tools/warm';
const MUNSHI_TOOLS_WARM_PATH = '/munshi-tools/warm';
const MAX_REPORTED_SECONDS = 3600;
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
export const UNEXPECTED_ERROR = 'The server sent an unexpected reply. Please try again.';

const DemoSchema = z.object({
  liveShopkeeper: z.object({ name: z.string(), shopName: z.string() }).nullable(),
});
const RingSchema = z.object({ status: z.literal('queued'), alreadyQueued: z.boolean() });
const IncomingSchema = z.object({
  call: z
    .object({
      callToken: z.uuid(),
      /** The business calling (the owner's shop). */
      callerName: z.string(),
      /** Who Saim answers as: any shopkeeper can get a live call (Live remind, pre-M6). */
      shopkeeperName: z.string(),
      shopName: z.string(),
    })
    .nullable(),
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
const MunshiSessionSchema = z.object({ state: z.enum(['ready', 'used', 'expired']) });
const MunshiAcceptedSchema = z.object({
  ownerCallToken: z.uuid(),
  ownerName: z.string(),
  ownerShortName: z.string(),
  businessName: z.string(),
  today: z.string(),
  sarvam: z.object({ orgId: z.string(), workspaceId: z.string(), appId: z.string() }),
});
const DoneSchema = z.object({ status: z.string() });
const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type DemoInfo = z.infer<typeof DemoSchema>;
export type IncomingCall = NonNullable<z.infer<typeof IncomingSchema>['call']>;
export type AcceptedCall = z.infer<typeof AcceptedSchema>;
export type MunshiLinkState = z.infer<typeof MunshiSessionSchema>['state'];
export type AcceptedMunshiCall = z.infer<typeof MunshiAcceptedSchema>;

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
  /** Munshi (M8): is the link still good? Changes nothing on the server. */
  munshiSession: (linkToken: string) => Promise<MunshiLinkState>;
  /** Start call: the link becomes used and the reply carries Munshi's variables. */
  munshiAccept: (linkToken: string) => Promise<AcceptedMunshiCall>;
  munshiEnded: (linkToken: string, report: EndedReport) => Promise<void>;
  /** Wakes Munshi's tool server (on open and every 2 minutes while the page is open). */
  warmMunshiTools: () => void;
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

/** Opaque GET to a tool server's /warm: no reply is read, so no CORS headers are needed.
 * Failures don't matter (the call still works; the first tool call may just be slower). */
function warmTools(callsApiUrl: string, path: string, fetchImpl: typeof fetch): void {
  const functionsBase = callsApiUrl.endsWith(CALLS_API_SUFFIX)
    ? callsApiUrl.slice(0, -CALLS_API_SUFFIX.length)
    : callsApiUrl;
  void fetchImpl(`${functionsBase}${path}`, { mode: 'no-cors' }).catch(() => null);
}

function endedBody(report: EndedReport): Record<string, unknown> {
  return {
    seconds: Math.min(MAX_REPORTED_SECONDS, Math.max(0, Math.round(report.seconds))),
    ...(report.interactionId ? { interactionId: report.interactionId } : {}),
  };
}

interface RequestExtras {
  readonly body?: unknown;
  /** The /munshi link token, sent in x-call-token. */
  readonly linkToken?: string;
}

interface Requester {
  readonly baseHeaders: Readonly<Record<string, string>>;
  readonly get: <T>(path: string, schema: z.ZodType<T>, extras?: RequestExtras) => Promise<T>;
  readonly post: <T>(path: string, schema: z.ZodType<T>, extras?: RequestExtras) => Promise<T>;
}

/** JSON requests to calls-api with the public headers (and the link token when given). */
function createRequester(options: AppApiOptions): Requester {
  const { baseUrl, anonKey, region, fetchImpl = fetch } = options;
  const baseHeaders = {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
    [REGION_HEADER]: region,
  };

  async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, signal }).catch(() => null);
    if (!response) throw new AppApiError(NETWORK_ERROR, null);
    if (!response.ok) throw await toApiError(response);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppApiError(UNEXPECTED_ERROR, null);
    return parsed.data;
  }

  function headersFor(extras: RequestExtras): Record<string, string> {
    const token = extras.linkToken === undefined ? {} : { [CALL_TOKEN_HEADER]: extras.linkToken };
    return { ...baseHeaders, ...token, 'Content-Type': 'application/json' };
  }

  return {
    baseHeaders,
    get: (path, schema, extras = {}) => call(path, schema, { headers: headersFor(extras) }),
    post: (path, schema, extras = {}) =>
      call(path, schema, {
        method: 'POST',
        headers: headersFor(extras),
        body: JSON.stringify(extras.body ?? {}),
      }),
  };
}

/** The /munshi page's steps (M8): the signed link token goes in x-call-token. */
function munshiSteps(
  request: Requester,
  warm: () => void,
): Pick<AppApi, 'munshiSession' | 'munshiAccept' | 'munshiEnded' | 'warmMunshiTools'> {
  return {
    munshiSession: async (linkToken) =>
      (await request.get('/v1/munshi/session', MunshiSessionSchema, { linkToken })).state,
    munshiAccept: (linkToken) =>
      request.post('/v1/munshi/accept', MunshiAcceptedSchema, { linkToken }),
    munshiEnded: async (linkToken, report) => {
      await request.post('/v1/munshi/ended', DoneSchema, { body: endedBody(report), linkToken });
    },
    warmMunshiTools: warm,
  };
}

export function createAppApi(options: AppApiOptions): AppApi {
  const { baseUrl, fetchImpl = fetch } = options;
  const request = createRequester(options);
  const { get, post } = request;
  const callPath = (token: string, step: string): string =>
    `/v1/calls/${encodeURIComponent(token)}/${step}`;

  return {
    getDemo: () => get('/v1/demo', DemoSchema),
    ring: () => post('/v1/demo/ring', RingSchema),
    incoming: async () => (await get('/v1/phone/incoming', IncomingSchema)).call,
    accept: (token) => post(callPath(token, 'accept'), AcceptedSchema),
    decline: async (token) => {
      await post(callPath(token, 'decline'), DoneSchema);
    },
    ended: async (token, report) => {
      await post(callPath(token, 'ended'), DoneSchema, { body: endedBody(report) });
    },
    warmTools: () => warmTools(baseUrl, TOOLS_WARM_PATH, fetchImpl),
    ...munshiSteps(request, () => warmTools(baseUrl, MUNSHI_TOOLS_WARM_PATH, fetchImpl)),
    sarvamProxy: (token) => ({
      baseUrl: `${baseUrl}${SARVAM_PROXY_PATH}`,
      headers: { ...request.baseHeaders, [CALL_TOKEN_HEADER]: token },
    }),
  };
}
