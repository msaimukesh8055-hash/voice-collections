// supabase/functions/_shared/db/supabase-rows.ts
// Database row shapes (snake_case, as PostgREST returns them) and their mapping to the
// Repository types. Every row read is parsed with Zod, so a schema drift fails loudly here
// instead of deep inside a tool.
import { z } from 'zod';
import { type LedgerEntry, LedgerEntrySchema, PAYMENT_MODES } from '../schemas/ledger.ts';
import { CallStatusSchema, IdentityStatusSchema, LanguageSchema } from '../schemas/shopkeeper.ts';
import type {
  CallPatch,
  CallSession,
  DemoSettings,
  SavedClaim,
  SavedPromise,
  Shopkeeper,
} from './repository.ts';

/** Postgres numeric can arrive as a number or a numeric string. */
const Rupees = z.coerce.number();

export const SHOPKEEPER_COLUMNS =
  'id,name,shop_name,language,do_not_call,owners(name,business_name)';
export const SESSION_COLUMNS = 'id,shopkeeper_id,mode,status,language,identity_status,' +
  'identity_unsure_count,interaction_id,queued_at,ringing_at,accepted_at,url_issued_at';
export const SETTINGS_COLUMNS =
  'demo_clock,calling_hours_enabled,call_limits_enabled,live_shopkeeper_id';
export const LEDGER_COLUMNS = 'kind,amount,entry_date,due_date,status';

export const IdRow = z.object({ id: z.uuid() });

const ShopkeeperRow = z.object({
  id: z.uuid(),
  name: z.string(),
  shop_name: z.string(),
  language: LanguageSchema,
  do_not_call: z.boolean(),
  owners: z.object({ name: z.string(), business_name: z.string() }),
});

const SessionRow = z.object({
  id: z.uuid(),
  shopkeeper_id: z.uuid(),
  mode: z.enum(['live', 'simulated']),
  status: CallStatusSchema,
  language: LanguageSchema,
  identity_status: IdentityStatusSchema,
  identity_unsure_count: z.number().int().min(0),
  interaction_id: z.string().nullable(),
  queued_at: z.string(),
  ringing_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  url_issued_at: z.string().nullable(),
});

const SettingsRow = z.object({
  demo_clock: z.string().nullable(),
  calling_hours_enabled: z.boolean(),
  call_limits_enabled: z.boolean(),
  live_shopkeeper_id: z.uuid().nullable(),
});

const LedgerRow = z.object({
  kind: z.string(),
  amount: Rupees,
  entry_date: z.string(),
  due_date: z.string().nullable(),
  status: z.string(),
});

const PromiseRow = z.object({ amount: Rupees, promise_date: z.iso.date() });

const ClaimRow = z.object({
  amount: Rupees,
  entry_date: z.iso.date(),
  payment_mode: z.enum(PAYMENT_MODES),
});

/** First row of a list response, or null. */
export function firstRow<T>(schema: z.ZodType<T>, rows: unknown): T | null {
  return z.array(schema).parse(rows)[0] ?? null;
}

export const SHOPKEEPER_ROW = ShopkeeperRow.transform((row): Shopkeeper => ({
  id: row.id,
  name: row.name,
  shopName: row.shop_name,
  language: row.language,
  doNotCall: row.do_not_call,
  ownerName: row.owners.name,
  businessName: row.owners.business_name,
}));

export const SESSION_ROW = SessionRow.transform((row): CallSession => ({
  callId: row.id,
  shopkeeperId: row.shopkeeper_id,
  mode: row.mode,
  status: row.status,
  language: row.language,
  identityStatus: row.identity_status,
  identityUnsureCount: row.identity_unsure_count,
  interactionId: row.interaction_id,
  queuedAt: row.queued_at,
  ringingAt: row.ringing_at,
  acceptedAt: row.accepted_at,
  urlIssuedAt: row.url_issued_at,
}));

export const SETTINGS_ROW = SettingsRow.transform((row): DemoSettings => ({
  demoClock: row.demo_clock,
  callingHoursEnabled: row.calling_hours_enabled,
  callLimitsEnabled: row.call_limits_enabled,
  liveShopkeeperId: row.live_shopkeeper_id,
}));

export const LEDGER_ROW = LedgerRow.transform((row): LedgerEntry =>
  LedgerEntrySchema.parse({
    kind: row.kind,
    amount: row.amount,
    entryDate: row.entry_date,
    dueDate: row.due_date,
    status: row.status,
  })
);

export const PROMISE_ROW = PromiseRow.transform((row): SavedPromise => ({
  amount: row.amount,
  promiseDate: row.promise_date,
}));

export const CLAIM_ROW = ClaimRow.transform((row): SavedClaim => ({
  amount: row.amount,
  paidDate: row.entry_date,
  mode: row.payment_mode,
}));

/** Column names for a status change; only the fields present are sent. */
export function toCallColumns(patch: CallPatch): Record<string, string | number> {
  const columns: Record<string, string | number | undefined> = {
    status: patch.status,
    ringing_at: patch.ringingAt,
    accepted_at: patch.acceptedAt,
    url_issued_at: patch.urlIssuedAt,
    ended_at: patch.endedAt,
    duration_seconds: patch.durationSeconds,
    interaction_id: patch.interactionId,
  };
  return Object.fromEntries(
    Object.entries(columns).filter((entry): entry is [string, string | number] =>
      entry[1] !== undefined
    ),
  );
}
