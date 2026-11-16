// scripts/lib/eval-cleanup.ts
// Which eval owners the clean-up may delete (M9 Build F). Rule (Saim, 2026-11-15): keep the
// newest eval run per agent, delete every older one. Only owners flagged is_eval are ever
// considered; an unflagged owner in the list stops the whole clean-up, so a mistake in a query
// can never reach the real book. Pure: the script does the reading and deleting.

export interface EvalOwnerRow {
  readonly id: string;
  readonly isEval: boolean;
  readonly evalAgent: string | null;
  /** The run that created it; a Munshi run creates one owner per case. */
  readonly evalRun: string | null;
  readonly createdAt: string;
}

export interface CleanupPlan {
  /** Agent → the run kept for it. */
  readonly kept: ReadonlyMap<string, string>;
  readonly keepIds: readonly string[];
  readonly deleteIds: readonly string[];
}

export class CleanupRefused extends Error {
  override name = 'CleanupRefused';
}

function runOf(owner: EvalOwnerRow): string {
  return owner.evalRun ?? owner.id;
}

export function planCleanup(owners: readonly EvalOwnerRow[]): CleanupPlan {
  const unflagged = owners.find((owner) => !owner.isEval);
  if (unflagged) throw new CleanupRefused(`owner ${unflagged.id} is not flagged as eval data`);
  // Newest run per agent, by the newest owner in it.
  const newest = new Map<string, { run: string; at: string }>();
  for (const owner of owners) {
    const agent = owner.evalAgent ?? 'unknown';
    const best = newest.get(agent);
    if (!best || owner.createdAt > best.at)
      newest.set(agent, { run: runOf(owner), at: owner.createdAt });
  }
  const kept = new Map([...newest].map(([agent, best]) => [agent, best.run]));
  const keepIds: string[] = [];
  const deleteIds: string[] = [];
  for (const owner of owners) {
    const keep = kept.get(owner.evalAgent ?? 'unknown') === runOf(owner);
    (keep ? keepIds : deleteIds).push(owner.id);
  }
  return { kept, keepIds, deleteIds };
}
