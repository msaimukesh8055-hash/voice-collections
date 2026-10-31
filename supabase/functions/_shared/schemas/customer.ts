// supabase/functions/_shared/schemas/customer.ts
import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;

export const LanguageSchema = z.enum(SUPPORTED_LANGUAGES);

export const CustomerSchema = z.object({
  id: z.uuid(),
  full_name: z.string().trim().min(1),
  dob: z.iso.date(),
  phone_masked: z.string().trim().min(1),
  preferred_language: LanguageSchema,
  city: z.string().trim().min(1),
  do_not_call: z.boolean(),
  hardship: z.boolean(),
});

export type Customer = z.infer<typeof CustomerSchema>;
export type Language = z.infer<typeof LanguageSchema>;
