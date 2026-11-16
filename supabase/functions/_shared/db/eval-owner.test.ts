// supabase/functions/_shared/db/eval-owner.test.ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import { createEvalOwnerReader } from './eval-owner.ts';
import type { PostgrestClient } from './postgrest.ts';

const OWNER_ID = '0e000000-0000-4000-8000-0000000000e1';
const ROW = {
  id: OWNER_ID,
  name: 'Srinivas Reddy',
  business_name: 'Sri Lakshmi Traders',
  city: 'EVAL DATA (not a real owner)',
  language: 'te',
  english_under_telugu: false,
};

function fakeQuery(rows: unknown[]): { query: PostgrestClient; paths: string[] } {
  const paths: string[] = [];
  const query: PostgrestClient = (_operation, path) => {
    paths.push(path);
    return Promise.resolve({ rows, contentRange: null });
  };
  return { query, paths };
}

Deno.test('eval owner › reads one owner by id, only when flagged is_eval', async () => {
  const { query, paths } = fakeQuery([ROW]);
  const owner = await createEvalOwnerReader(query)(OWNER_ID);
  assertEquals(owner?.businessName, 'Sri Lakshmi Traders');
  assertStringIncludes(paths[0] ?? '', `id=eq.${OWNER_ID}`);
  assertStringIncludes(paths[0] ?? '', 'is_eval=eq.true');
});

Deno.test('eval owner › no row (the real owner, or unknown) → null', async () => {
  const { query } = fakeQuery([]);
  assertEquals(await createEvalOwnerReader(query)(OWNER_ID), null);
});
