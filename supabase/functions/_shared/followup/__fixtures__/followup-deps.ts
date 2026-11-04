// supabase/functions/_shared/followup/__fixtures__/followup-deps.ts
// Everything the follow-up worker needs, faked: repositories, LLM, Sarvam transcripts and the
// WhatsApp client (nothing is sent anywhere). FAKE DATA ONLY.
import { createFakeBookRepository, type FakeBookState } from '../../db/fake-book-repository.ts';
import {
  createFakeFollowupRepository,
  type FakeFollowupState,
} from '../../db/fake-followup-repository.ts';
import { createFakeRepository, type FakeState } from '../../db/fake-repository.ts';
import type { LogFields, LogLevel } from '../../log.ts';
import type { TranscriptClient, TranscriptResult } from '../../sarvam-analytics.ts';
import type { WhatsAppClient } from '../../whatsapp/client.ts';
import type { Reply } from '../../whatsapp/replies.ts';
import type { FollowupDeps } from '../process.ts';
import { fakeLlm } from './fake-llm.ts';

/** Fake owner number: digits only, never a real phone. */
export const FAKE_OWNER_NUMBER = '910000000001';
/** Two minutes after the fixture call ended (12:04 IST, Mon 2 Nov). */
export const WORKER_NOW = new Date('2026-11-02T06:34:00.000Z');

export interface SentMessage {
  readonly to: string;
  readonly reply: Reply;
}

export interface FollowupSetupOptions {
  readonly repo?: Partial<FakeState>;
  readonly followups?: Partial<FakeFollowupState>;
  readonly book?: Partial<FakeBookState>;
  readonly llmAnswers?: Readonly<Record<string, readonly (string | null)[]>>;
  readonly transcript?: TranscriptResult;
  readonly sendFails?: boolean;
  readonly now?: Date;
}

export interface FollowupSetup {
  readonly deps: FollowupDeps;
  readonly repo: ReturnType<typeof createFakeRepository>;
  readonly followups: ReturnType<typeof createFakeFollowupRepository>;
  readonly book: ReturnType<typeof createFakeBookRepository>;
  readonly llm: ReturnType<typeof fakeLlm>;
  readonly sent: SentMessage[];
  readonly requeued: string[];
  readonly logs: { level: LogLevel; event: string; fields: LogFields }[];
}

/** The fake transcript link: `<base><call id>#t=TOKEN` (fix 8). */
export const FAKE_CALL_LINK_BASE = 'https://dashboard.example/calls?id=';

export function followupSetup(options: FollowupSetupOptions = {}): FollowupSetup {
  const repo = createFakeRepository({ ...options.repo });
  const followups = createFakeFollowupRepository(options.followups);
  const book = createFakeBookRepository(options.book);
  const llm = fakeLlm(options.llmAnswers);
  const sent: SentMessage[] = [];
  const requeued: string[] = [];
  const logs: { level: LogLevel; event: string; fields: LogFields }[] = [];
  const transcripts: TranscriptClient = {
    fetchTranscript: () => Promise.resolve(options.transcript ?? { kind: 'not_ready' }),
    findInteractionId: () => Promise.resolve(null),
  };
  const whatsapp: WhatsAppClient = {
    send: (to, reply) => {
      sent.push({ to, reply });
      return Promise.resolve(options.sendFails ? null : `wamid.fake${sent.length}`);
    },
  };
  const deps: FollowupDeps = {
    repo: repo.repo,
    followups: followups.followups,
    book: book.book,
    llm: llm.llm,
    transcripts,
    whatsapp,
    owner: { ownerNumber: FAKE_OWNER_NUMBER, hashKey: 'fake-app-secret' },
    clock: () => options.now ?? WORKER_NOW,
    log: (level, event, fields = {}) => logs.push({ level, event, fields }),
    requeue: (callId) => requeued.push(callId),
    callLink: (callId) => Promise.resolve(`${FAKE_CALL_LINK_BASE}${callId}#t=TOKEN`),
  };
  return { deps, repo, followups, book, llm, sent, requeued, logs };
}
