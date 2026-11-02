// supabase/functions/_shared/tools/guards.ts
// Verify-before-disclose, enforced in code: the LLM can be talked out of a prompt rule, not this.
import type { CallSession } from '../db/repository.ts';
import { fail, type ToolOutcome } from './types.ts';

/** Returns a refusal when the caller is not verified, otherwise null. */
export function requireVerified(session: CallSession): ToolOutcome | null {
  return session.verified ? null : fail('NOT_VERIFIED');
}
