// supabase/functions/_shared/tools/guards.ts
// "No amount before identity", enforced in code (ADR-0005): the LLM can be talked out of a prompt
// rule, not this.
import type { CallSession } from '../db/repository.ts';
import { fail, type ToolOutcome } from './types.ts';

/** Returns a refusal (with no amounts) unless the person confirmed who they are. */
export function requireIdentity(session: CallSession): ToolOutcome | null {
  if (session.identityStatus === 'confirmed') return null;
  return fail(session.identityStatus === 'denied' ? 'IDENTITY_DENIED' : 'IDENTITY_NOT_CONFIRMED');
}
