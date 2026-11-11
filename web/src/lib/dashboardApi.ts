// web/src/lib/dashboardApi.ts
// Browser client for the dashboard's calls-api routes (M6, SPEC §12). The owner opens the page
// from the WhatsApp link `/#t=<token>`; the token is moved into this tab's sessionStorage and
// removed from the address bar, then sent as x-dashboard-token on every read. Replies are checked
// with Zod. With no token the reads are still sent (a public demo server answers them); a 401
// (missing or expired token) becomes `needsLink` so the page can say "open it from
// WhatsApp" instead of an error. On `npm run dev` only (ADR-0017 addendum), a page with no link
// asks the local Vite server for a token instead; production builds never pass `devToken`.
import { z } from 'zod';
import { DASHBOARD_TOKEN_HEADER } from '@shared/auth/dashboard-header.ts';
import { REGION_HEADER } from '@shared/region.ts';
import { LanguageSchema } from '@shared/schemas/shopkeeper.ts';
import { AppApiError, NETWORK_ERROR, UNEXPECTED_ERROR } from './appApi.ts';
import { type Evals, EvalsSchema } from './evalsSchemas.ts';
import { type OpsSummary, OpsSummarySchema, type Trace, TraceSchema } from './opsSchemas.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const STORAGE_KEY = 'dashboardToken';
const HASH_TOKEN = /(?:^#|&)t=([^&]+)/;

const BandSchema = z.enum(['reliable', 'watch', 'risky', 'new']);
const CostSchema = z.object({ inr: z.number(), estimate: z.boolean() });
const CallRowSchema = z.object({
  id: z.string(),
  shopkeeperId: z.string(),
  mode: z.enum(['live', 'simulated']),
  status: z.string(),
  language: LanguageSchema,
  toneLevel: z.number(),
  queuedAt: z.string(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  summary: z.string().nullable(),
  shopkeeperName: z.string(),
  shopName: z.string(),
  cost: CostSchema,
});
const ShopkeeperSchema = z.object({
  id: z.string(),
  name: z.string(),
  shopName: z.string(),
  area: z.string(),
  language: LanguageSchema,
});
const SplitSchema = z.object({
  month: z.string(),
  collected: z.number(),
  notYetDue: z.number(),
  overdue: z.number(),
  total: z.number(),
});
const OverviewSchema = z.object({
  owner: z.object({ name: z.string(), businessName: z.string() }),
  settings: z.object({ englishUnderTelugu: z.boolean() }),
  insights: z.object({
    today: z.string(),
    split: SplitSchema,
    percentCollected: z.number().nullable(),
    weekChange: z.number().nullable(),
    outstanding: z.number(),
    top: z.array(
      z.object({
        shopkeeper: ShopkeeperSchema,
        overdueAmount: z.number(),
        daysOverdue: z.number(),
        score: z.number(),
        band: BandSchema,
      }),
    ),
  }),
  calls: z.array(CallRowSchema),
});
const ShopkeeperListSchema = z.object({
  today: z.string(),
  shopkeepers: z.array(
    ShopkeeperSchema.extend({
      outstanding: z.number(),
      overdueAmount: z.number(),
      daysOverdue: z.number(),
    }),
  ),
});
const ShopkeeperDetailSchema = z.object({
  today: z.string(),
  shopkeeper: ShopkeeperSchema,
  dues: z.object({
    outstanding: z.number(),
    overdueAmount: z.number(),
    daysOverdue: z.number(),
    nextDueDate: z.string().nullable(),
    nextDueAmount: z.number(),
  }),
  score: z.object({
    score: z.number(),
    band: BandSchema,
    parts: z.object({
      paidOnTime: z.number(),
      promisesKept: z.number(),
      currentOverdue: z.number(),
      answersCalls: z.number(),
    }),
  }),
  entries: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['credit', 'payment']),
      amount: z.number(),
      entryDate: z.string(),
      dueDate: z.string().nullable(),
      status: z.string(),
    }),
  ),
  promises: z.array(
    z.object({
      amount: z.number(),
      promiseDate: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  notes: z.array(z.object({ note: z.string(), createdAt: z.string() })),
  calls: z.array(CallRowSchema),
});
const CallListSchema = z.object({ calls: z.array(CallRowSchema) });
const CallDetailSchema = z.object({
  call: CallRowSchema.extend({
    transcript: z
      .array(z.object({ role: z.enum(['assistant', 'user']), content: z.string() }))
      .nullable(),
    transcriptEnglish: z.array(z.string().nullable()).nullable(),
    toolEvents: z.array(
      z.object({
        tool: z.string(),
        args: z.record(z.string(), z.unknown()),
        result: z.record(z.string(), z.unknown()),
        durationMs: z.number().nullable(),
        createdAt: z.string(),
      }),
    ),
    followup: z
      .object({ path: z.enum(['rule', 'agent']), decision: z.string(), reasoning: z.string() })
      .nullable(),
  }),
});
const SettingsSchema = z.object({ settings: z.object({ englishUnderTelugu: z.boolean() }) });
const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type Band = z.infer<typeof BandSchema>;
export type CallRow = z.infer<typeof CallRowSchema>;
export type Overview = z.infer<typeof OverviewSchema>;
export type ShopkeeperList = z.infer<typeof ShopkeeperListSchema>;
export type ShopkeeperDetail = z.infer<typeof ShopkeeperDetailSchema>;
export type CallDetail = z.infer<typeof CallDetailSchema>['call'];

export interface DashboardApi {
  readonly hasToken: () => boolean;
  /** Resolves true when reads use a localhost dev token (the page shows "Local demo mode"). */
  readonly localDemo: () => Promise<boolean>;
  overview: () => Promise<Overview>;
  shopkeepers: () => Promise<ShopkeeperList>;
  shopkeeper: (id: string) => Promise<ShopkeeperDetail>;
  calls: () => Promise<readonly CallRow[]>;
  call: (id: string) => Promise<CallDetail>;
  setEnglishUnderTelugu: (on: boolean) => Promise<boolean>;
  /** M9: the ops page's numbers, and every step of one request. */
  ops: () => Promise<OpsSummary>;
  trace: (id: string) => Promise<Trace>;
  /** M9: stored eval runs, the latest case by case. */
  evals: () => Promise<Evals>;
}

/** Thrown when the link is missing or expired: the page asks to reopen it from WhatsApp. */
export class NeedsLinkError extends Error {
  override name = 'NeedsLinkError';
}

export interface TokenPlace {
  readonly hash: string;
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Removes the token from the address bar once it is stored. */
  readonly clearHash: () => void;
}

/** The address with the token's "#t=…" taken off and everything else kept: a call link
 * `/calls?id=<call id>#t=…` (dry-run fix 8) stays on that call, and a customer link
 * `/shopkeepers?id=<shopkeeper id>#t=…` (reply links) stays on that customer. */
export function addressWithoutToken(location: Pick<Location, 'pathname' | 'search'>): string {
  return location.pathname + location.search;
}

/** Takes the token from the link (`#t=…`) or this tab's storage; storage may be unavailable. */
export function readToken(place: TokenPlace): string | null {
  const fromLink = HASH_TOKEN.exec(place.hash)?.[1] ?? null;
  if (fromLink) {
    try {
      place.storage?.setItem(STORAGE_KEY, fromLink);
    } catch {
      // Private mode or blocked storage: the token still works for this page view.
    }
    place.clearHash();
    return fromLink;
  }
  try {
    return place.storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export interface DashboardApiOptions {
  readonly baseUrl: string;
  readonly anonKey: string;
  readonly region: string;
  readonly token: string | null;
  /** Dev only: fetches a localhost token when there is no link token. Never set in production. */
  readonly devToken?: (() => Promise<string | null>) | undefined;
  readonly fetchImpl?: typeof fetch;
}

const DevTokenSchema = z.object({ token: z.string().min(1) });

/** Asks the local Vite dev server for a token (web/dev/devDashboardToken.ts); null if it has none. */
export async function fetchDevToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl('/__dev/dashboard-token').catch(() => null);
  if (!response?.ok) return null;
  const parsed = DevTokenSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.token : null;
}

async function errorOf(response: Response): Promise<Error> {
  if (response.status === 401) return new NeedsLinkError('Link missing or expired');
  const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  return body.success
    ? new AppApiError(body.data.error.message, body.data.error.code)
    : new AppApiError(UNEXPECTED_ERROR, null);
}

interface TokenSource {
  readonly current: () => Promise<string | null>;
  /** True once a localhost dev token was fetched and is in use. */
  readonly isLocal: () => boolean;
  /**
   * Dev only: the link token was refused (expired or forged, e.g. an old one left in this tab's
   * storage), so stop using it and switch to the localhost token. True if `sent` was the link
   * token and there is a localhost token to try (every read refused with the link retries once,
   * even when several were in flight together).
   */
  readonly dropLink: (sent: string) => boolean;
}

/** The link token; else (dev only) one localhost token, fetched once and shared by all reads. */
function tokenSource(token: string | null, devToken: DashboardApiOptions['devToken']): TokenSource {
  let load: Promise<string | null> | null = null;
  let local = false;
  let linkRefused = false;
  return {
    current: async () => {
      if (!devToken || (token && !linkRefused)) return token;
      load ??= devToken();
      const fetched = await load;
      local = fetched !== null;
      return fetched;
    },
    isLocal: () => local,
    dropLink: (sent) => {
      if (!devToken || !token || sent !== token) return false;
      linkRefused = true;
      return true;
    },
  };
}

function requestHeaders(
  options: Pick<DashboardApiOptions, 'anonKey' | 'region'>,
  token: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.anonKey}`,
    apikey: options.anonKey,
    [REGION_HEADER]: options.region,
    'Content-Type': 'application/json',
  };
  return token ? { ...headers, [DASHBOARD_TOKEN_HEADER]: token } : headers;
}

export function createDashboardApi(options: DashboardApiOptions): DashboardApi {
  const { baseUrl, anonKey, region, token, devToken, fetchImpl = fetch } = options;
  const tokens = tokenSource(token, devToken);

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    // No link token: still ask, because a public demo server (DASHBOARD_PUBLIC=on) answers
    // reads without one; a locked server answers 401, which becomes "open it from WhatsApp".
    const sendToken = await tokens.current();
    const headers = requestHeaders({ anonKey, region }, sendToken);
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, signal }).catch(
      () => null,
    );
    if (!response) throw new AppApiError(NETWORK_ERROR, null);
    // Dev only: a refused link token gets one retry with the localhost token.
    if (response.status === 401 && sendToken && tokens.dropLink(sendToken))
      return request(path, schema, init);
    if (!response.ok) throw await errorOf(response);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppApiError(UNEXPECTED_ERROR, null);
    return parsed.data;
  }

  const id = encodeURIComponent;
  return {
    hasToken: () => token !== null || tokens.isLocal(),
    localDemo: () => tokens.current().then(tokens.isLocal),
    overview: () => request('/v1/dashboard/overview', OverviewSchema),
    shopkeepers: () => request('/v1/dashboard/shopkeepers', ShopkeeperListSchema),
    shopkeeper: (shopkeeperId) =>
      request(`/v1/dashboard/shopkeepers/${id(shopkeeperId)}`, ShopkeeperDetailSchema),
    calls: async () => (await request('/v1/dashboard/calls', CallListSchema)).calls,
    call: async (callId) =>
      (await request(`/v1/dashboard/calls/${id(callId)}`, CallDetailSchema)).call,
    ops: () => request('/v1/dashboard/ops', OpsSummarySchema),
    evals: () => request('/v1/dashboard/evals', EvalsSchema),
    trace: (traceId) => request(`/v1/dashboard/ops/traces/${id(traceId)}`, TraceSchema),
    setEnglishUnderTelugu: async (on) => {
      const body = JSON.stringify({ englishUnderTelugu: on });
      const reply = await request('/v1/dashboard/settings', SettingsSchema, {
        method: 'POST',
        body,
      });
      return reply.settings.englishUnderTelugu;
    },
  };
}
