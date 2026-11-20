// supabase/functions/_shared/db/test-draft-repository.ts
// Live failures to tests (2026-11-20): drafts saved from a call report or a WhatsApp trace with
// "Add as a test case", waiting to be written up as scripted tests. Service role only.

export const TEST_DRAFT_SOURCES = ['asha_call', 'munshi_call', 'whatsapp'] as const;
export type TestDraftSource = (typeof TEST_DRAFT_SOURCES)[number];
export type TestDraftStatus = 'waiting' | 'added' | 'dropped';

export interface NewTestDraft {
  readonly source: TestDraftSource;
  readonly refId: string;
  /** What the caller or owner said (from the transcript, or typed for a WhatsApp message). */
  readonly said: string;
  /** What went wrong, e.g. the scorecard checks that failed or warned. */
  readonly problem: string;
  /** What should have happened, in the owner's words; optional. */
  readonly expected: string | null;
}

export interface TestDraft extends NewTestDraft {
  readonly id: string;
  readonly status: TestDraftStatus;
  readonly createdAt: string;
}

export interface TestDraftRepository {
  /** Saves a draft; the same call or message again replaces its words, keeping one draft. */
  saveTestDraft(draft: NewTestDraft): Promise<void>;
  /** Newest first. */
  listTestDrafts(limit: number): Promise<readonly TestDraft[]>;
}
