// supabase/functions/_shared/db/book-rows.ts
// Row shapes for the owner bot's tables, parsed with Zod and mapped to BookRepository types.
import { z } from 'zod';
import { LEDGER_KINDS, LEDGER_STATUSES, PAYMENT_MODES } from '../schemas/ledger.ts';
import { LanguageSchema } from '../schemas/shopkeeper.ts';
import {
  ACTION_KINDS,
  ACTION_STATUSES,
  type BookEntry,
  type BookShopkeeper,
  type LastPromise,
  type Owner,
  type PendingAction,
  PROMISE_STATUSES,
} from './book-repository.ts';

const Rupees = z.coerce.number().positive();

export const OWNER_COLUMNS = 'id,name,business_name,city,language';
export const BOOK_SHOPKEEPER_COLUMNS = 'id,name,shop_name,area,language';
export const ENTRY_COLUMNS =
  'id,shopkeeper_id,kind,amount,entry_date,due_date,status,payment_mode,created_at';
export const ACTION_COLUMNS = 'id,kind,payload,status,expires_at';

export const OWNER_ROW = z.object({
  id: z.uuid(),
  name: z.string(),
  business_name: z.string(),
  city: z.string(),
  language: LanguageSchema,
}).transform((row): Owner => ({
  id: row.id,
  name: row.name,
  businessName: row.business_name,
  city: row.city,
  language: row.language,
}));

export const BOOK_SHOPKEEPER_ROW = z.object({
  id: z.uuid(),
  name: z.string(),
  shop_name: z.string(),
  area: z.string(),
  language: LanguageSchema,
}).transform((row): BookShopkeeper => ({
  id: row.id,
  name: row.name,
  shopName: row.shop_name,
  area: row.area,
  language: row.language,
}));

export const ENTRY_ROW = z.object({
  id: z.uuid(),
  shopkeeper_id: z.uuid(),
  kind: z.enum(LEDGER_KINDS),
  amount: Rupees,
  entry_date: z.iso.date(),
  due_date: z.iso.date().nullable(),
  status: z.enum(LEDGER_STATUSES),
  payment_mode: z.enum(PAYMENT_MODES).nullable(),
  created_at: z.string(),
}).transform((row): BookEntry => ({
  id: row.id,
  shopkeeperId: row.shopkeeper_id,
  kind: row.kind,
  amount: row.amount,
  entryDate: row.entry_date,
  dueDate: row.due_date,
  status: row.status,
  paymentMode: row.payment_mode,
  createdAt: row.created_at,
}));

export const LAST_PROMISE_ROW = z.object({
  amount: Rupees,
  promise_date: z.iso.date(),
  status: z.enum(PROMISE_STATUSES),
}).transform((row): LastPromise => ({
  amount: row.amount,
  promiseDate: row.promise_date,
  status: row.status,
}));

export const ACTION_ROW = z.object({
  id: z.uuid(),
  kind: z.enum(ACTION_KINDS),
  payload: z.unknown(),
  status: z.enum(ACTION_STATUSES),
  expires_at: z.string(),
}).transform((row): PendingAction => ({
  id: row.id,
  kind: row.kind,
  payload: row.payload,
  status: row.status,
  expiresAt: row.expires_at,
}));
