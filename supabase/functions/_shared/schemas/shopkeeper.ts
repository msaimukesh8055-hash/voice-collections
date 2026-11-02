// supabase/functions/_shared/schemas/shopkeeper.ts
// Shopkeeper and call vocabulary shared by the functions, the dashboard and the agent config.
import { z } from 'zod';

/** Telugu, Hindi, English (SPEC §7.6). Codes match the database check constraints. */
export const SUPPORTED_LANGUAGES = ['te', 'hi', 'en'] as const;
export const LanguageSchema = z.enum(SUPPORTED_LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

/** Sarvam's language names, used for the call's starting language. */
export const SARVAM_LANGUAGE_NAMES = {
  te: 'Telugu',
  hi: 'Hindi',
  en: 'English',
} as const satisfies Readonly<Record<Language, string>>;

export const CALL_STATUSES = [
  'queued',
  'ringing',
  'accepted',
  'in_progress',
  'completed',
  'declined',
  'missed',
] as const;
export const CallStatusSchema = z.enum(CALL_STATUSES);
export type CallStatus = z.infer<typeof CallStatusSchema>;

export const IDENTITY_STATUSES = ['unknown', 'confirmed', 'denied'] as const;
export const IdentityStatusSchema = z.enum(IDENTITY_STATUSES);
export type IdentityStatus = z.infer<typeof IdentityStatusSchema>;
