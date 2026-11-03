// supabase/functions/_shared/followup/gather.ts
// Loads everything one follow-up needs in one round of parallel reads, runs the promise checker
// on the demo clock (writing any kept/broken change), and builds the call facts.
import { istDate, resolveNow } from '../clock.ts';
import { countRecentBroken } from '../calls/tone.ts';
import type { FollowupCall, FollowupRepository } from '../db/followup-repository.ts';
import type { Repository, Shopkeeper } from '../db/repository.ts';
import { computeDues } from '../ledger/dues.ts';
import { applyPromiseChanges, checkPromises, type PromiseRecord } from '../ledger/promise-check.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import type { CallFacts } from './facts.ts';
import type { TranscriptStep } from './transcript-step.ts';

export interface GatherDeps {
  readonly repo: Repository;
  readonly followups: FollowupRepository;
  readonly clock: () => Date;
}

export interface Gathered {
  readonly facts: CallFacts;
  readonly entries: readonly LedgerEntry[];
  /** After today's promise check. */
  readonly promises: readonly PromiseRecord[];
  readonly callStatuses: readonly CallStatus[];
  readonly today: string;
}

interface Loaded {
  readonly shopkeeper: Shopkeeper;
  readonly entries: readonly LedgerEntry[];
  readonly promises: readonly PromiseRecord[];
  readonly callStatuses: readonly CallStatus[];
  readonly today: string;
}

async function load(call: FollowupCall, deps: GatherDeps): Promise<Loaded | null> {
  const id = call.shopkeeperId;
  const [settings, shopkeeper, entries, stored, callStatuses] = await Promise.all([
    deps.repo.getDemoSettings(),
    deps.repo.getShopkeeper(id),
    deps.repo.getLedger(id),
    deps.repo.listPromises(id),
    deps.followups.listCallStatuses(id),
  ]);
  if (!shopkeeper) return null;
  const today = istDate(resolveNow(settings.demoClock, deps.clock()));
  const changes = checkPromises(stored, entries, today);
  await Promise.all(changes.map((change) => deps.repo.setPromiseStatus(change.id, change.status)));
  const promises = applyPromiseChanges(stored, changes);
  return { shopkeeper, entries, promises, callStatuses, today };
}

export async function gatherFacts(
  call: FollowupCall,
  transcript: TranscriptStep,
  deps: GatherDeps,
): Promise<Gathered | null> {
  const [loaded, outcome] = await Promise.all([
    load(call, deps),
    deps.followups.getCallOutcome(call.callId),
  ]);
  if (!loaded) return null;
  const { shopkeeper, entries, promises, today } = loaded;
  const facts: CallFacts = {
    callId: call.callId,
    shopkeeperId: call.shopkeeperId,
    shopkeeperName: shopkeeper.name,
    shopName: shopkeeper.shopName,
    mode: call.mode,
    connected: call.status === 'completed',
    declined: call.status === 'declined',
    identity: call.identityStatus,
    ...outcome,
    toneLevel: call.toneLevel,
    daysOverdue: computeDues(entries, today).daysOverdue,
    brokenPromises: countRecentBroken(promises, today),
    today,
    transcript: transcript.kind === 'ready' ? transcript.turns : null,
    transcriptMissing: transcript.kind === 'missing',
  };
  return { facts, entries, promises, callStatuses: loaded.callStatuses, today };
}
