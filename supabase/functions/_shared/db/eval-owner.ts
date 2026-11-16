// supabase/functions/_shared/db/eval-owner.ts
// Reads one eval owner by id (M9 Build F). Eval runs create their own flagged owners
// (owners.is_eval = true) so test calls never touch the real book; Munshi's tool server serves
// such an owner only when the call token belongs to it. The is_eval filter is in the query, so
// the real owner (is_eval = false) can never come back from here.
import type { Owner } from './book-repository.ts';
import { OWNER_COLUMNS, OWNER_ROW } from './book-rows.ts';
import type { PostgrestClient } from './postgrest.ts';
import { firstRow } from './supabase-rows.ts';

export type GetEvalOwner = (ownerId: string) => Promise<Owner | null>;

export function createEvalOwnerReader(query: PostgrestClient): GetEvalOwner {
  return async function getEvalOwner(ownerId: string): Promise<Owner | null> {
    const path = `owners?select=${OWNER_COLUMNS}&id=eq.${encodeURIComponent(ownerId)}` +
      '&is_eval=eq.true&limit=1';
    return firstRow(OWNER_ROW, (await query('getEvalOwner', path)).rows);
  };
}
