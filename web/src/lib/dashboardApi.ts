// web/src/lib/dashboardApi.ts
// Browser client for the dashboard's calls-api routes (M6, SPEC §12). The owner opens the page
// from the WhatsApp link `/#t=<token>`; the token is moved into this tab's sessionStorage and
// removed from the address bar, then sent as x-dashboard-token on every read. Replies are checked
// with Zod. A missing or expired token becomes `needsLink` so the page can say "open it from
// WhatsApp" instead of an error.
import { z } from 'zod';
import { DASHBOARD_TOKEN_HEADER } from '@shared/auth/dashboard-header.ts';
import { REGION_HEADER } from '@shared/region.ts';
import { LanguageSchema } from '@shared/schemas/shopkeeper.ts';
import { AppApiError, NETWORK_ERROR, UNEXPECTED_ERROR } from './appApi.ts';

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
  overview: () => Promise<Overview>;
  shopkeepers: () => Promise<ShopkeeperList>;
  shopkeeper: (id: string) => Promise<ShopkeeperDetail>;
  calls: () => Promise<readonly CallRow[]>;
  call: (id: string) => Promise<CallDetail>;
  setEnglishUnderTelugu: (on: boolean) => Promise<boolean>;
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
  readonly fetchImpl?: typeof fetch;
}

async function errorOf(response: Response): Promise<Error> {
  if (response.status === 401) return new NeedsLinkError('Link missing or expired');
  const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  return body.success
    ? new AppApiError(body.data.error.message, body.data.error.code)
    : new AppApiError(UNEXPECTED_ERROR, null);
}

export function createDashboardApi(options: DashboardApiOptions): DashboardApi {
  const { baseUrl, anonKey, region, token, fetchImpl = fetch } = options;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    if (!token) throw new NeedsLinkError('No link');
    const headers = {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      [REGION_HEADER]: region,
      [DASHBOARD_TOKEN_HEADER]: token,
      'Content-Type': 'application/json',
    };
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, signal }).catch(
      () => null,
    );
    if (!response) throw new AppApiError(NETWORK_ERROR, null);
    if (!response.ok) throw await errorOf(response);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new AppApiError(UNEXPECTED_ERROR, null);
    return parsed.data;
  }

  const id = encodeURIComponent;
  return {
    hasToken: () => token !== null,
    overview: () => request('/v1/dashboard/overview', OverviewSchema),
    shopkeepers: () => request('/v1/dashboard/shopkeepers', ShopkeeperListSchema),
    shopkeeper: (shopkeeperId) =>
      request(`/v1/dashboard/shopkeepers/${id(shopkeeperId)}`, ShopkeeperDetailSchema),
    calls: async () => (await request('/v1/dashboard/calls', CallListSchema)).calls,
    call: async (callId) =>
      (await request(`/v1/dashboard/calls/${id(callId)}`, CallDetailSchema)).call,
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
