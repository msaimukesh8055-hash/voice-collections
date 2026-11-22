// web/src/lib/testDraftSchemas.ts
// "Add as a test case" (Saim, 2026-11-20): what the page sends, and the drafts waiting to
// become scripted tests (calls-api/test-draft-routes.ts). Checked with Zod.
import { z } from 'zod';

export const TEST_DRAFT_SOURCES = [
  'asha_call',
  'munshi_call',
  'whatsapp',
  'whatsapp_chat',
] as const;
export type TestDraftSource = (typeof TEST_DRAFT_SOURCES)[number];

export interface NewTestDraft {
  readonly source: TestDraftSource;
  readonly refId: string;
  /** Typed by the owner; needed for a WhatsApp message, filled by the server for a call. */
  readonly said?: string;
  readonly expected?: string;
}

export const TestDraftSchema = z.object({
  id: z.string(),
  source: z.enum(TEST_DRAFT_SOURCES),
  refId: z.string(),
  said: z.string(),
  problem: z.string(),
  expected: z.string().nullable(),
  status: z.enum(['waiting', 'added', 'dropped']),
  createdAt: z.string(),
});

export const TestDraftListSchema = z.object({ drafts: z.array(TestDraftSchema) });
export const SavedSchema = z.object({ saved: z.literal(true) });

export type TestDraft = z.infer<typeof TestDraftSchema>;
