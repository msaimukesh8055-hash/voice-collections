// supabase/functions/_shared/followup/process.test.ts
// The worker's job for one call, end to end on fakes: idempotency (a call is followed up once),
// transcript waiting, rules vs agent, note, score and the owner's summary.
import { assert, assertEquals } from '@std/assert';
import { FAKE_OWNER } from '../db/fake-book-repository.ts';
import { FAKE_RAMESH, FAKE_RAMESH_PROMISES } from '../db/fake-repository.ts';
import { replyText } from '../whatsapp/replies.ts';
import { CLAIM, PROMISE } from './__fixtures__/facts.ts';
import {
  FAKE_CALL_LINK_BASE,
  FAKE_OWNER_NUMBER,
  type FollowupSetup,
  followupSetup,
  type FollowupSetupOptions,
  WORKER_NOW,
} from './__fixtures__/followup-deps.ts';
import { CALL_ID, followupCall } from './__fixtures__/followup-call.ts';
import { AGENT_EVENT } from './agent.ts';
import { NOTE_EVENT } from './note.ts';
import { MAX_FOLLOWUP_ATTEMPTS, processFollowup, sweepFollowups } from './process.ts';

const TRANSCRIPT = {
  kind: 'ready',
  turns: [
    { role: 'assistant', content: 'Last time you said Friday for 3,000. What happened?' },
    { role: 'user', content: 'I will pay 2,000 next Monday.' },
  ],
} as const;
const NOTE = '{"note":"Promised 2,000 for Monday; calm and apologetic."}';

function promiseSetup(extra: FollowupSetupOptions = {}): FollowupSetup {
  return followupSetup({
    followups: {
      calls: [followupCall()],
      outcomes: { [CALL_ID]: { promise: PROMISE, claim: null, callbacks: [] } },
      callStatuses: { [FAKE_RAMESH.id]: ['completed'] },
    },
    transcript: TRANSCRIPT,
    llmAnswers: { [NOTE_EVENT]: [NOTE] },
    book: { owner: { ...FAKE_OWNER, language: 'en' } },
    ...extra,
  });
}

Deno.test('worker › a promise call: rule run, note, follow-up row, score, summary, done', async () => {
  const { deps, followups, sent, book } = promiseSetup();
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  const state = followups.state;
  assertEquals(state.runs.map((run) => [run.path, run.decision]), [['rule', 'check_promise']]);
  assertEquals(state.notes[0]?.note, 'Promised 2,000 for Monday; calm and apologetic.');
  assertEquals(state.followups[0]?.kind, 'promise_check');
  assertEquals(state.scores[0]?.shopkeeperId, FAKE_RAMESH.id);
  assertEquals(sent.length, 1);
  assertEquals(sent[0]?.to, FAKE_OWNER_NUMBER);
  const text = replyText([sent[0]!.reply]);
  assert(text.includes('Result: Promised ₹2,000 by Mon 9 Nov') && !text.includes('level 2'));
  // Dry-run fix 8: the summary links to this call's dashboard page.
  assert(text.includes(`🔗 Transcript: ${FAKE_CALL_LINK_BASE}${CALL_ID}#t=TOKEN`));
  assertEquals(book.state.outbound[0]?.waMessageId, 'wamid.fake1');
  assertEquals(state.calls[0]?.followupStatus, 'done');
  assertEquals(state.finished[0]?.result.transcript, TRANSCRIPT.turns);
  assert(state.finished[0]?.result.summary?.includes('Promised'));
});

Deno.test('worker › idempotent: a second run of the same call does nothing', async () => {
  const { deps, followups, sent } = promiseSetup();
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assertEquals(await processFollowup(CALL_ID, deps), 'skipped');
  assertEquals([followups.state.runs.length, sent.length], [1, 1]);
});

Deno.test('worker › two workers at once: one wins the claim, one summary', async () => {
  const { deps, followups, sent } = promiseSetup();
  const outcomes = await Promise.all([
    processFollowup(CALL_ID, deps),
    processFollowup(CALL_ID, deps),
  ]);
  assertEquals([...outcomes].sort(), ['done', 'skipped']);
  assertEquals([followups.state.runs.length, sent.length], [1, 1]);
});

Deno.test('worker › a run already committed → duplicate, no second summary', async () => {
  const existing = {
    callId: CALL_ID,
    shopkeeperId: FAKE_RAMESH.id,
    path: 'rule',
    decision: 'check_promise',
    reasoning: 'x',
    actions: {},
  } as const;
  const { deps, followups, sent } = promiseSetup();
  followups.state.runs = [existing];
  assertEquals(await processFollowup(CALL_ID, deps), 'duplicate');
  assertEquals(sent.length, 0);
  assertEquals(followups.state.calls[0]?.followupStatus, 'done');
});

Deno.test('worker › transcript lagging: released, asked again later, nothing sent', async () => {
  const { deps, followups, sent, requeued } = promiseSetup({ transcript: { kind: 'not_ready' } });
  assertEquals(await processFollowup(CALL_ID, deps), 'waiting');
  const call = followups.state.calls[0];
  assertEquals([call?.followupStatus, call?.followupAttempts], ['pending', 1]);
  assertEquals(call?.followupNextAt, '2026-11-02T06:34:15.000Z');
  assertEquals(requeued, [CALL_ID]);
  assertEquals(sent.length, 0);
});

Deno.test('worker › an early retry finds the call not yet due and leaves it', async () => {
  const { deps } = promiseSetup({
    followups: { calls: [followupCall({ followupNextAt: '2026-11-02T06:35:00.000Z' })] },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'skipped');
});

Deno.test('worker › 10 minutes without a transcript → summary from tool events', async () => {
  const later = new Date('2026-11-02T06:42:00.000Z');
  const { deps, sent, followups } = promiseSetup({ transcript: { kind: 'not_ready' }, now: later });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assert(replyText([sent[0]!.reply]).includes('Transcript not available'));
  assertEquals(followups.state.notes[0]?.note, 'Promised ₹2,000 by Mon 9 Nov. (No transcript.)');
  assertEquals(followups.state.runs[0]?.actions['transcript'], 'missing');
});

Deno.test('worker › a claim: summary with [Confirm received] [Not received]', async () => {
  const { deps, sent, followups } = promiseSetup({
    followups: {
      calls: [followupCall()],
      outcomes: { [CALL_ID]: { promise: null, claim: CLAIM, callbacks: [] } },
    },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assertEquals(sent[0]?.reply.kind, 'buttons');
  assertEquals(followups.state.followups[0]?.kind, 'claim_confirm');
});

Deno.test('worker › declined call: no transcript needed, "try again", code note', async () => {
  const { deps, sent, followups, llm } = promiseSetup({
    followups: { calls: [followupCall({ status: 'declined', identityStatus: 'unknown' })] },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assert(replyText([sent[0]!.reply]).includes('Try again later'));
  assertEquals(followups.state.notes[0]?.note, 'Declined the call on Mon 2 Nov.');
  assertEquals(llm.calls.length, 0);
});

Deno.test('worker › mixed signals: the agent decides; both bad → owner should call', async () => {
  const { deps, followups, sent } = promiseSetup({
    followups: {
      calls: [followupCall()],
      outcomes: {
        [CALL_ID]: {
          promise: null,
          claim: null,
          callbacks: [{ reason: 'hardship', summary: 'Shop shut, illness.' }],
        },
      },
    },
    llmAnswers: { [AGENT_EVENT]: ['nope', 'nope'], [NOTE_EVENT]: [NOTE] },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  const run = followups.state.runs[0];
  assertEquals([run?.path, run?.decision, run?.actions['agent_path']], [
    'agent',
    'owner_should_call',
    'default',
  ]);
  assertEquals(followups.state.followups[0]?.kind, 'owner_callback');
  assert(replyText([sent[0]!.reply]).includes('Please call Ramesh.'));
});

Deno.test('worker › the promise check runs on the demo clock before deciding', async () => {
  const open = { ...FAKE_RAMESH_PROMISES[1]!, status: 'open' as const };
  const { deps, repo } = promiseSetup({ repo: { promiseHistory: [open] } });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assertEquals(repo.state.promiseHistory[0]?.status, 'broken');
});

Deno.test('worker › an error before the commit: logged safely, released and retried', async () => {
  const { deps, followups, requeued, logs, sent } = promiseSetup();
  const failing = {
    ...deps,
    repo: { ...deps.repo, getLedger: () => Promise.reject(new Error('Ramesh 8500 secret')) },
  };
  assertEquals(await processFollowup(CALL_ID, failing), 'failed');
  assertEquals(followups.state.calls[0]?.followupStatus, 'pending');
  assertEquals(requeued, [CALL_ID]);
  assertEquals(sent.length, 0);
  assertEquals(JSON.stringify(logs).includes('Ramesh'), false);
});

Deno.test('worker › gives up after too many attempts', async () => {
  const { deps, followups } = promiseSetup({
    followups: { calls: [followupCall({ followupAttempts: MAX_FOLLOWUP_ATTEMPTS })] },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'failed');
  assertEquals(followups.state.calls[0]?.followupStatus, 'failed');
});

Deno.test('worker › a failed step after the commit is logged; the rest still happens', async () => {
  const { deps, followups, logs, book } = promiseSetup({ sendFails: true });
  const failing = {
    ...deps,
    followups: { ...deps.followups, insertNote: () => Promise.reject(new TypeError('down')) },
  };
  assertEquals(await processFollowup(CALL_ID, failing), 'done');
  assertEquals(followups.state.scores.length, 1);
  assertEquals(book.state.outbound[0]?.waMessageId, null);
  assert(logs.some((log) => log.event === 'followup_step_failed' && log.fields['step'] === 'note'));
});

Deno.test('worker › a summary that cannot be built leaves the call done without one', async () => {
  const { deps, followups } = promiseSetup();
  const failing = {
    ...deps,
    whatsapp: { send: () => Promise.reject(new TypeError('down')) },
  };
  assertEquals(await processFollowup(CALL_ID, failing), 'done');
  assertEquals(followups.state.finished[0]?.result.summary, null);
});

Deno.test("worker › the summary is in the owner's language; no owner row → English", async () => {
  const telugu = promiseSetup({ book: { owner: FAKE_OWNER } });
  await processFollowup(CALL_ID, telugu.deps);
  assert(replyText([telugu.sent[0]!.reply]).includes('Asha Ramesh కి కాల్ చేసింది'));
  const { deps, sent } = promiseSetup({ book: { owner: null } });
  await processFollowup(CALL_ID, deps);
  assert(replyText([sent[0]!.reply]).includes('Asha called Ramesh'));
});

Deno.test('worker › a stale running claim is taken over; a fresh one is not', async () => {
  const stale = followupCall({
    followupStatus: 'running',
    followupClaimedAt: '2026-11-02T06:20:00.000Z',
  });
  assertEquals(
    await processFollowup(CALL_ID, promiseSetup({ followups: { calls: [stale] } }).deps),
    'done',
  );
  const fresh = followupCall({
    followupStatus: 'running',
    followupClaimedAt: '2026-11-02T06:33:00.000Z',
  });
  assertEquals(
    await processFollowup(CALL_ID, promiseSetup({ followups: { calls: [fresh] } }).deps),
    'skipped',
  );
});

Deno.test('worker › unknown call or unknown shopkeeper → not found', async () => {
  const { deps } = promiseSetup();
  assertEquals(await processFollowup('ca000000-0000-4000-8000-0000000000ff', deps), 'not_found');
  const noShopkeeper = promiseSetup({ repo: { shopkeepers: [] } });
  assertEquals(await processFollowup(CALL_ID, noShopkeeper.deps), 'not_found');
  assertEquals(noShopkeeper.followups.state.calls[0]?.followupStatus, 'failed');
});

Deno.test('worker › calls with no follow-up queued are skipped', async () => {
  const { deps } = promiseSetup({ followups: { calls: [followupCall({ followupStatus: null })] } });
  assertEquals(await processFollowup(CALL_ID, deps), 'skipped');
});

Deno.test('sweep › runs every due follow-up', async () => {
  const other = followupCall({
    callId: 'ca000000-0000-4000-8000-0000000000bb',
    followupStatus: 'done',
  });
  const { deps, sent } = promiseSetup({ followups: { calls: [followupCall(), other] } });
  assertEquals(await sweepFollowups(deps), ['done']);
  assertEquals(sent.length, 1);
  assertEquals(WORKER_NOW.toISOString(), '2026-11-02T06:34:00.000Z');
});

Deno.test("worker › Asha's own callback request adds no second follow-up row", async () => {
  const { deps, followups, sent } = promiseSetup({
    followups: {
      calls: [followupCall()],
      outcomes: {
        [CALL_ID]: {
          promise: null,
          claim: null,
          callbacks: [{ reason: 'wants_owner', summary: 'Wants to talk about a bill.' }],
        },
      },
    },
  });
  assertEquals(await processFollowup(CALL_ID, deps), 'done');
  assertEquals(followups.state.followups, []);
  assert(replyText([sent[0]!.reply]).includes('Please call Ramesh. Wants to talk about a bill.'));
});

Deno.test('worker › Telugu owner: the LLM is asked for Telugu lines; the summary has them, no English', async () => {
  const note = JSON.stringify({
    note: 'Promised 2,000 for Monday; calm.',
    summary_en: ['Will pay ₹2,000 next Monday.'],
    summary: ['వచ్చే సోమవారం ₹2,000 కడతానన్నారు.'],
  });
  const { deps, sent, llm } = promiseSetup({
    book: { owner: FAKE_OWNER },
    llmAnswers: { [NOTE_EVENT]: [note] },
  });
  await processFollowup(CALL_ID, deps);
  assert(llm.calls[0]?.message.includes("Owner's language: Telugu"));
  const reply = sent[0]!.reply;
  assert(reply.kind === 'text');
  assert(reply.text.includes('• వచ్చే సోమవారం ₹2,000 కడతానన్నారు.'));
  assert(!reply.text.includes('Will pay'));
  assert(reply.english?.includes('• Will pay ₹2,000 next Monday.'));
  assert(reply.text.includes(`🔗 సంభాషణ: ${FAKE_CALL_LINK_BASE}${CALL_ID}#t=TOKEN`));
});
