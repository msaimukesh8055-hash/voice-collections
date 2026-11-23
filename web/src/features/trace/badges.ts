// web/src/features/trace/badges.ts
// Section menu badges (2026-11-23): the small mark after a section's name, so a closed section
// still says whether something in it needs a look.
import type { PlainTrace } from './plainTrace.ts';

export const TIMELINE_TITLE = 'What happened in the call';

const VERDICT_BADGES = { good: '✅', check: '⚠', failed: '❌' } as const;

export function verdictBadge(verdict: keyof typeof VERDICT_BADGES): string {
  return VERDICT_BADGES[verdict];
}

/** "⚠ 2" when steps are flagged or a needed tool never ran; nothing when all went well. */
export function timelineBadge(trace: PlainTrace): string | null {
  const flagged = trace.items.filter((item) => item.flags.length > 0).length;
  const missed = trace.notRun.filter((row) => row.missed).length;
  const count = flagged + missed;
  return count > 0 ? `⚠ ${count}` : null;
}
