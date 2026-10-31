// supabase/functions/_shared/env.ts
import { z } from 'zod';

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export class MissingEnvError extends Error {
  override name = 'MissingEnvError';
}

/** Validates server env at startup. Reports variable names only — never values. */
export function loadServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new MissingEnvError(`Missing or invalid environment variables: ${names}`);
}
