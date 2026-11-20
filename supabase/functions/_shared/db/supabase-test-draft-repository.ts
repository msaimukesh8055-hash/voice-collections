// supabase/functions/_shared/db/supabase-test-draft-repository.ts
// TestDraftRepository over the database HTTP API (service role); upserts on (source, ref_id).
import { z } from 'zod';
import type { PostgrestClient } from './postgrest.ts';
import {
  TEST_DRAFT_SOURCES,
  type TestDraft,
  type TestDraftRepository,
} from './test-draft-repository.ts';

const DraftRow = z.object({
  id: z.string(),
  source: z.enum(TEST_DRAFT_SOURCES),
  ref_id: z.string(),
  said: z.string(),
  problem: z.string(),
  expected: z.string().nullable(),
  status: z.enum(['waiting', 'added', 'dropped']),
  created_at: z.string(),
}).transform((row): TestDraft => ({
  id: row.id,
  source: row.source,
  refId: row.ref_id,
  said: row.said,
  problem: row.problem,
  expected: row.expected,
  status: row.status,
  createdAt: row.created_at,
}));

export function createSupabaseTestDraftRepository(query: PostgrestClient): TestDraftRepository {
  return {
    async saveTestDraft(draft): Promise<void> {
      await query('saveTestDraft', 'test_drafts?on_conflict=source,ref_id', {
        method: 'POST',
        body: {
          source: draft.source,
          ref_id: draft.refId,
          said: draft.said,
          problem: draft.problem,
          expected: draft.expected,
        },
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
    async listTestDrafts(limit): Promise<readonly TestDraft[]> {
      const path = 'test_drafts?select=id,source,ref_id,said,problem,expected,status,created_at' +
        `&order=created_at.desc&limit=${limit}`;
      return z.array(DraftRow).parse((await query('listTestDrafts', path)).rows);
    },
  };
}
