// supabase/functions/_shared/cards/schemas.ts
// What a confirmation card holds (pending_actions.payload), checked with Zod when a button is
// tapped: the row is ours, but it is still parsed, never trusted (coding-standards → Validation).
import { z } from 'zod';
import { MAX_AMOUNT } from '../brain/amounts.ts';
import { LanguageSchema } from '../schemas/shopkeeper.ts';
import { MAX_LIST_ROWS } from '../whatsapp/replies.ts';

/** Cards expire after 30 minutes (M4 Decision 4). */
export const CARD_TTL_MS = 30 * 60 * 1000;

export const DraftSchema = z.object({
  type: z.enum(['credit', 'payment']),
  amount: z.number().positive().max(MAX_AMOUNT),
  /** Credits: what the owner said, or null for the 15-day default. Payments: always null. */
  dueDate: z.iso.date().nullable(),
  note: z.string().max(60).nullable(),
});

export const EntryPayloadSchema = z.object({
  shopkeeperId: z.uuid(),
  draft: DraftSchema.extend({ dueDefaulted: z.boolean() }),
  language: LanguageSchema,
});

export const PickPayloadSchema = z.object({
  name: z.string().min(1),
  candidates: z.array(z.uuid()).min(1).max(MAX_LIST_ROWS),
  draft: DraftSchema,
  language: LanguageSchema,
});

export const NewShopkeeperPayloadSchema = z.object({
  name: z.string().min(1).max(60),
  draft: DraftSchema,
  language: LanguageSchema,
});

export type Draft = z.infer<typeof DraftSchema>;
export type EntryPayload = z.infer<typeof EntryPayloadSchema>;
export type PickPayload = z.infer<typeof PickPayloadSchema>;
export type NewShopkeeperPayload = z.infer<typeof NewShopkeeperPayloadSchema>;
