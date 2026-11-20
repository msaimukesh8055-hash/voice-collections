// supabase/functions/_shared/db/fake-test-draft-repository.ts
// In-memory TestDraftRepository for tests. FAKE DATA ONLY.
import type { TestDraft, TestDraftRepository } from './test-draft-repository.ts';

export function fakeTestDraftRepository(): {
  readonly repo: TestDraftRepository;
  readonly drafts: TestDraft[];
} {
  const drafts: TestDraft[] = [];
  let made = 0;
  const repo: TestDraftRepository = {
    saveTestDraft(draft): Promise<void> {
      const at = drafts.findIndex((one) =>
        one.source === draft.source && one.refId === draft.refId
      );
      if (at === -1) {
        made += 1;
        drafts.unshift({
          ...draft,
          id: `d0000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
          status: 'waiting',
          createdAt: `2026-11-20T10:00:${String(made).padStart(2, '0')}Z`,
        });
      } else {
        const before = drafts[at] as TestDraft;
        drafts[at] = { ...before, ...draft };
      }
      return Promise.resolve();
    },
    listTestDrafts: (limit) => Promise.resolve(drafts.slice(0, limit)),
  };
  return { repo, drafts };
}
