// supabase/functions/_shared/reminders/owner-send.ts
// The follow-up worker's /owner-send/<actionId> job (M8 B5, Decision 3): what the owner asked
// Munshi to send on WhatsApp, after his spoken yes. Only a voice_send action that confirm_action
// saved, belonging to the owner, is sent, and only once: the compare-and-set saved → done runs
// before anything goes out (at most once; a failed send is logged, never retried twice). The
// replies are built with today's WhatsApp builders (pending + its list, the due alert, one
// shopkeeper's lookup, insights), so they read exactly like typing the command. The insights
// chart picture is left out (no upload here); the figures and the dashboard link are the same.
import { istDate, resolveNow } from '../clock.ts';
import type { BookRepository, BookShopkeeper, Owner } from '../db/book-repository.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import type { VoiceActionRepository } from '../db/voice-action-repository.ts';
import { computeInsights } from '../ledger/insights.ts';
import { insightsReplies } from '../ledger/insights-reply.ts';
import type { Score } from '../ledger/score.ts';
import { pendingOpenList, pendingReply, shopkeeperReplies, shownPending } from '../ledger/views.ts';
import type { Logger } from '../log.ts';
import { VOICE_PAYLOADS, type VoicePayload } from '../owner-tools/actions.ts';
import type { SendWhat } from '../owner-tools/schemas.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';
import type { Reply } from '../whatsapp/replies.ts';
import { identifySender, type SenderConfig } from '../whatsapp/sender.ts';
import { dueAlertReplies } from './alert-replies.ts';
import { loadDueAlert } from './load-alert.ts';
import { scoreFrom, type ScoreReads } from './score-explain.ts';

export interface OwnerSendDeps {
  readonly actions: Pick<VoiceActionRepository, 'getVoiceAction' | 'transitionVoiceAction'>;
  readonly book: BookRepository;
  readonly store: Pick<ReminderRepository, 'listAlertPromises'>;
  readonly repo: Pick<
    Repository,
    'getDemoSettings' | 'listPromises' | 'getLastNote' | 'setPromiseStatus'
  >;
  readonly listCallStatuses: (shopkeeperId: string) => Promise<readonly CallStatus[]>;
  readonly whatsapp: WhatsAppClient;
  readonly owner: SenderConfig;
  /** Signed dashboard links when a dashboard is set up, else null (the line is left out). */
  readonly dashboardLink: () => Promise<string | null>;
  readonly shopkeeperLink: (shopkeeperId: string) => Promise<string | null>;
  readonly clock: () => Date;
  readonly log: Logger;
}

export type OwnerSendOutcome =
  | 'sent'
  | 'not_found'
  | 'not_a_send'
  | 'not_owner'
  | 'already_sent'
  | 'no_shopkeeper';

interface SendScope {
  readonly owner: Owner;
  readonly shopkeepers: readonly BookShopkeeper[];
  readonly today: string;
  readonly payload: VoicePayload<'voice_send'>;
}

type Builder = (scope: SendScope, deps: OwnerSendDeps) => Promise<readonly Reply[] | null>;

function scoreReads(deps: OwnerSendDeps): ScoreReads {
  return {
    listPromises: (shopkeeperId) => deps.repo.listPromises(shopkeeperId),
    listCallStatuses: deps.listCallStatuses,
  };
}

async function scoresOf(
  rows: ReadonlyArray<Parameters<typeof scoreFrom>[1] & { readonly shopkeeperId: string }>,
  deps: OwnerSendDeps,
): Promise<ReadonlyMap<string, Score>> {
  const scores = await Promise.all(rows.map((row) => scoreFrom(scoreReads(deps), row)));
  return new Map(rows.map((row, index) => [row.shopkeeperId, scores[index]!]));
}

async function pending(scope: SendScope, deps: OwnerSendDeps): Promise<readonly Reply[]> {
  const entries = await deps.book.listEntries(scope.owner.id);
  const view = { ...scope, entries, language: scope.owner.language };
  const rows = shownPending(view).map((row) => ({
    shopkeeperId: row.shopkeeper.id,
    entries: row.entries,
    today: scope.today,
  }));
  const reply = pendingReply({ ...view, scores: await scoresOf(rows, deps) });
  const list = pendingOpenList(view);
  return list ? [reply, list] : [reply];
}

async function due(scope: SendScope, deps: OwnerSendDeps): Promise<readonly Reply[]> {
  const source = { book: deps.book, store: deps.store, repo: deps.repo };
  const { alert } = await loadDueAlert(source, {
    ownerId: scope.owner.id,
    shopkeepers: scope.shopkeepers,
    today: scope.today,
  });
  return dueAlertReplies(alert, scope.today, scope.owner.language);
}

async function statement(scope: SendScope, deps: OwnerSendDeps): Promise<readonly Reply[] | null> {
  const shopkeeper = scope.shopkeepers.find((each) => each.id === scope.payload.shopkeeperId);
  if (!shopkeeper) return null;
  const [entries, lastPromise, lastNote, booksLink] = await Promise.all([
    deps.book.listShopkeeperEntries(shopkeeper.id),
    deps.book.getLastPromise(shopkeeper.id),
    deps.repo.getLastNote(shopkeeper.id),
    deps.shopkeeperLink(shopkeeper.id),
  ]);
  const score = await scoreFrom(scoreReads(deps), {
    shopkeeperId: shopkeeper.id,
    entries,
    today: scope.today,
  });
  const { today, owner } = scope;
  return shopkeeperReplies({
    shopkeeper,
    entries,
    lastPromise,
    lastNote,
    score,
    today,
    language: owner.language,
    booksLink,
  });
}

async function insights(scope: SendScope, deps: OwnerSendDeps): Promise<readonly Reply[]> {
  const entries = await deps.book.listEntries(scope.owner.id);
  const figures = computeInsights(scope.shopkeepers, entries, scope.today);
  const rows = figures.top.map(({ shopkeeper }) => ({
    shopkeeperId: shopkeeper.id,
    entries: entries.filter((entry) => entry.shopkeeperId === shopkeeper.id),
    today: scope.today,
  }));
  const [scores, dashboardLink] = await Promise.all([scoresOf(rows, deps), deps.dashboardLink()]);
  return insightsReplies({
    insights: figures,
    scores,
    language: scope.owner.language,
    chartId: null,
    dashboardLink,
  });
}

/** What → today's builder (typed lookup, no switch). */
const BUILDERS: Readonly<Record<SendWhat, Builder>> = { pending, due, statement, insights };

async function send(replies: readonly Reply[], deps: OwnerSendDeps): Promise<void> {
  const now = deps.clock();
  const { senderHash } = await identifySender(deps.owner.ownerNumber, deps.owner);
  for (const reply of replies) {
    const waMessageId = await deps.whatsapp.send(deps.owner.ownerNumber, reply);
    await deps.book.recordOutbound({
      waMessageId,
      senderHash,
      msgType: reply.kind,
      istDay: istDate(now),
    });
  }
}

export async function sendOwnerRequest(
  actionId: string,
  deps: OwnerSendDeps,
): Promise<OwnerSendOutcome> {
  const [action, owner, settings] = await Promise.all([
    deps.actions.getVoiceAction(actionId),
    deps.book.getOwner(),
    deps.repo.getDemoSettings(),
  ]);
  if (!action) return 'not_found';
  const payload = VOICE_PAYLOADS.voice_send.safeParse(action.data);
  if (action.kind !== 'voice_send' || !payload.success) return 'not_a_send';
  if (!owner || owner.id !== action.ownerId) return 'not_owner';
  // Once only: an action that is not saved (open, cancelled, already done) sends nothing.
  if (!(await deps.actions.transitionVoiceAction(action.id, 'saved', 'done'))) {
    return 'already_sent';
  }
  const today = istDate(resolveNow(settings.demoClock, deps.clock()));
  const shopkeepers = await deps.book.listShopkeepers(owner.id);
  const scope = { owner, shopkeepers, today, payload: payload.data };
  const replies = await BUILDERS[payload.data.what](scope, deps);
  if (replies === null) return 'no_shopkeeper';
  await send(replies, deps);
  deps.log('info', 'owner_send_sent', { what: payload.data.what, messages: replies.length });
  return 'sent';
}
