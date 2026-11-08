// supabase/functions/munshi-tools/handler.test.ts
import { assert, assertEquals } from '@std/assert';
import {
  createFakeBookRepository,
  type FakeBookState,
  RAMESH,
} from '../_shared/db/fake-book-repository.ts';
import { createFakeFollowupRepository } from '../_shared/db/fake-followup-repository.ts';
import {
  createFakeOwnerCallRepository,
  FAKE_OWNER_CALL_ID,
  type FakeOwnerCall,
  fakeOwnerCall,
  type FakeOwnerCallState,
} from '../_shared/db/fake-owner-call-repository.ts';
import { createFakeReminderRepository } from '../_shared/db/fake-reminder-repository.ts';
import {
  createFakeVoiceActionRepository,
  type FakeVoiceActionState,
} from '../_shared/db/fake-voice-action-repository.ts';
import { createFakeRepository, FAKE_NOW, fakeCall } from '../_shared/db/fake-repository.ts';
import type { Owner } from '../_shared/db/book-repository.ts';
import type { LogFields, Logger } from '../_shared/log.ts';
import { OWNER_TOOL_TTL_MS } from '../_shared/calls/owner-call-limits.ts';
import { WRAP_UP_AFTER_MS, WRAP_UP_NOTE } from '../_shared/owner-tools/wrap-up.ts';
import { AUDIT_MARKERS } from '../_shared/tools/define.ts';
import { handleOwnerToolRequest, type OwnerToolsDeps } from './handler.ts';

const SECRET = 'o'.repeat(40);
const ASHA_SECRET = 's'.repeat(40);
const BASE = 'https://ref.supabase.co/functions/v1/munshi-tools';
const TOKEN = { owner_call_token: FAKE_OWNER_CALL_ID };

interface Setup {
  readonly deps: OwnerToolsDeps;
  readonly state: FakeOwnerCallState;
  readonly logs: Array<{ event: string; fields: LogFields }>;
  readonly reads: { count: number };
  readonly book: FakeBookState;
  readonly voice: FakeVoiceActionState;
  readonly kicked: string[];
}

interface SetupOptions {
  readonly owner?: Owner | null;
  readonly demoClock?: string | null;
  readonly listEntries?: () => Promise<never>;
  readonly insertOwnerToolEvent?: () => Promise<void>;
  readonly getOwnerCall?: () => Promise<never>;
  readonly clock?: () => Date;
}

function setup(call: Partial<FakeOwnerCall> = {}, options: SetupOptions = {}): Setup {
  const fake = createFakeOwnerCallRepository({ ownerCalls: [fakeOwnerCall(call)] });
  const fakeBook = createFakeBookRepository(
    options.owner === undefined ? {} : { owner: options.owner },
  );
  const { book } = fakeBook;
  const voice = createFakeVoiceActionRepository();
  const kicked: string[] = [];
  const settings = {
    demoClock: options.demoClock ?? null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const { repo } = createFakeRepository({ settings });
  const reads = { count: 0 };
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const log: Logger = (_level, event, fields = {}) => logs.push({ event, fields });
  const ownerCalls = {
    ...fake.ownerCalls,
    getOwnerCall: (id: string) => {
      reads.count += 1;
      return fake.ownerCalls.getOwnerCall(id);
    },
    ...(options.getOwnerCall ? { getOwnerCall: options.getOwnerCall } : {}),
    ...(options.insertOwnerToolEvent ? { insertOwnerToolEvent: options.insertOwnerToolEvent } : {}),
  };
  const deps: OwnerToolsDeps = {
    ownerCalls,
    reads: {
      book: options.listEntries ? { ...book, listEntries: options.listEntries } : book,
      memory: repo,
      alerts: createFakeReminderRepository().reminders,
      listCallStatuses: createFakeFollowupRepository().followups.listCallStatuses,
    },
    writes: {
      actions: voice.actions,
      book,
      queueCall: () =>
        Promise.resolve({ ok: true, callId: crypto.randomUUID(), alreadyQueued: false }),
      kickOwnerSend: (actionId) => {
        kicked.push(actionId);
      },
    },
    getDemoSettings: () => repo.getDemoSettings(),
    getOwner: () => book.getOwner(),
    secret: SECRET,
    clock: options.clock ?? (() => FAKE_NOW),
    log,
  };
  return { deps, state: fake.state, logs, reads, book: fakeBook.state, voice: voice.state, kicked };
}

function toolRequest(
  tool: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
): Request {
  return new Request(`${BASE}/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function reply(response: Response): Promise<Record<string, unknown>> {
  assertEquals(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

function minutesAgo(minutes: number): string {
  return new Date(FAKE_NOW.getTime() - minutes * 60_000).toISOString();
}

const OVERVIEW = { ...TOKEN, focus: 'overview' };

Deno.test('munshi-tools › no secret → 401, nothing read or written', async () => {
  const { deps, state, reads } = setup();
  const response = await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW, {}), deps);
  assertEquals(response.status, 401);
  assertEquals([state.events.length, reads.count], [0, 0]);
});

Deno.test("munshi-tools › Asha's tool secret is refused (401)", async () => {
  const { deps, state } = setup();
  const headers = { authorization: `Bearer ${ASHA_SECRET}` };
  const response = await handleOwnerToolRequest(
    toolRequest('book_summary', OVERVIEW, headers),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals(state.events.length, 0);
});

Deno.test('munshi-tools › GET /warm → 204, reads and writes nothing', async () => {
  const { deps, state, reads } = setup();
  const response = await handleOwnerToolRequest(new Request(`${BASE}/warm`), deps);
  assertEquals(response.status, 204);
  assertEquals(await response.text(), '');
  assertEquals([state.events.length, reads.count], [0, 0]);
});

Deno.test('munshi-tools › only POST is allowed; a non-JSON body → 400', async () => {
  const { deps } = setup();
  const get = await handleOwnerToolRequest(new Request(`${BASE}/book_summary`), deps);
  const bad = await handleOwnerToolRequest(toolRequest('book_summary', 'not json'), deps);
  assertEquals([get.status, bad.status], [405, 400]);
});

Deno.test('munshi-tools › missing or unknown token → refused, nothing written', async () => {
  const { deps, state } = setup();
  const missing = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', { focus: 'overview' }), deps),
  );
  const unknown = await reply(
    await handleOwnerToolRequest(
      toolRequest('book_summary', { owner_call_token: crypto.randomUUID(), focus: 'overview' }),
      deps,
    ),
  );
  assertEquals([missing['code'], unknown['code']], ['CALL_NOT_AUTHORISED', 'CALL_NOT_AUTHORISED']);
  assertEquals(state.events.length, 0);
});

Deno.test("munshi-tools › a shopkeeper call's token never opens the owner's book", async () => {
  const { deps, state } = setup();
  const shopkeeperCall = fakeCall({ status: 'in_progress' });
  const body = await reply(
    await handleOwnerToolRequest(
      toolRequest('book_summary', { owner_call_token: shopkeeperCall.callId, focus: 'overview' }),
      deps,
    ),
  );
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(body['outstanding'], undefined);
  assertEquals(state.events.length, 0);
});

Deno.test('munshi-tools › issued, completed and expired owner calls are refused (audited)', async () => {
  for (const status of ['issued', 'completed', 'expired'] as const) {
    const { deps, state } = setup({ status });
    const body = await reply(
      await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
    );
    assertEquals(body['code'], 'CALL_NOT_AUTHORISED', status);
    assertEquals(state.events[0]?.args, AUDIT_MARKERS.notAuthorised);
  }
});

Deno.test('munshi-tools › more than 10 minutes after Start call → refused', async () => {
  const acceptedAt = new Date(FAKE_NOW.getTime() - OWNER_TOOL_TTL_MS - 1000).toISOString();
  const { deps } = setup({ status: 'in_progress', acceptedAt });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('munshi-tools › an accepted call with no accept time is refused', async () => {
  const { deps } = setup({ acceptedAt: null });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('munshi-tools › a call row of another owner, or no owner, is refused', async () => {
  const other = setup({ ownerId: '0e000000-0000-4000-8000-000000000099' });
  const none = setup({}, { owner: null });
  for (const { deps } of [other, none]) {
    const body = await reply(
      await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
    );
    assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
  }
  assertEquals(
    other.logs.find((entry) => entry.event === 'owner_call_not_authorised')?.fields['reason'],
    'owner_mismatch',
  );
});

Deno.test("munshi-tools › Asha's tool names do not exist here (UNKNOWN_TOOL, audited)", async () => {
  for (const tool of ['get_dues', 'confirm_identity', 'log_promise', 'wipe_ledger']) {
    const { deps, state } = setup();
    const body = await reply(await handleOwnerToolRequest(toolRequest(tool, TOKEN), deps));
    assertEquals(body['code'], 'UNKNOWN_TOOL', tool);
    assertEquals(state.events[0]?.args, AUDIT_MARKERS.unknownTool);
  }
});

Deno.test('munshi-tools › book_summary: flat reply, one audit row without the token', async () => {
  const { deps, state, logs } = setup({ status: 'in_progress' });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals([body['ok'], body['focus'], body['outstanding']], [true, 'overview', 10500]);
  assert(typeof body['say'] === 'string');
  assertEquals(state.events.length, 1);
  assertEquals(state.events[0]?.ownerCallId, FAKE_OWNER_CALL_ID);
  assertEquals(state.events[0]?.args, { focus: 'overview' });
  assert(logs.some((entry) => entry.event === 'owner_tool_call'));
});

Deno.test('munshi-tools › lookup_shopkeeper: Ramesh on the owner context', async () => {
  const { deps } = setup();
  const args = { ...TOKEN, name: 'ramesh' };
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('lookup_shopkeeper', args), deps),
  );
  assertEquals([body['shopkeeper'], body['outstanding'], body['open_claims']], [
    RAMESH.name,
    8500,
    1,
  ]);
});

Deno.test('munshi-tools › bad arguments → INVALID_ARGS, no crash', async () => {
  const { deps } = setup();
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', { ...TOKEN, focus: 'all' }), deps),
  );
  assertEquals(body['code'], 'INVALID_ARGS');
});

Deno.test('munshi-tools › the demo clock decides the day', async () => {
  const { deps } = setup({}, { demoClock: '2026-11-06T12:00:00+05:30' });
  const args = { ...TOKEN, name: 'Ramesh' };
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('lookup_shopkeeper', args), deps),
  );
  assertEquals(body['days_overdue'], 16);
});

Deno.test('munshi-tools › from 7:00 after Start call every reply carries the wrap-up note', async () => {
  const early = setup({ acceptedAt: minutesAgo(6) });
  const late = setup({
    status: 'in_progress',
    acceptedAt: new Date(FAKE_NOW.getTime() - WRAP_UP_AFTER_MS).toISOString(),
  });
  const before = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), early.deps),
  );
  const after = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), late.deps),
  );
  assert(!String(before['say']).includes(WRAP_UP_NOTE));
  assert(String(after['say']).endsWith(WRAP_UP_NOTE));
});

Deno.test('munshi-tools › a database error replies safely and logs why', async () => {
  const listEntries = (): Promise<never> => Promise.reject(new Error('timeout'));
  const { deps, logs, state } = setup({}, { listEntries });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals(body['code'], 'TEMPORARY_ERROR');
  assertEquals(logs.find((entry) => entry.event === 'owner_tool_call')?.fields['error'], 'Error');
  assertEquals(state.events.length, 1);
});

Deno.test('munshi-tools › a failed audit write is logged; the reply still goes out', async () => {
  const insertOwnerToolEvent = (): Promise<void> => Promise.reject(new Error('db down'));
  const { deps, logs } = setup({}, { insertOwnerToolEvent });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals(body['ok'], true);
  assert(logs.some((entry) => entry.event === 'owner_audit_write_failed'));
});

Deno.test('munshi-tools › an unexpected crash becomes a generic 500', async () => {
  const getOwnerCall = (): Promise<never> => Promise.reject(new Error('boom'));
  const { deps } = setup({}, { getOwnerCall });
  const response = await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps);
  assertEquals(response.status, 500);
});

Deno.test('munshi-tools › the owner never comes from the arguments', async () => {
  const { deps } = setup();
  const args = { ...OVERVIEW, owner_id: '0e000000-0000-4000-8000-000000000099' };
  const body = await reply(await handleOwnerToolRequest(toolRequest('book_summary', args), deps));
  assertEquals([body['ok'], body['outstanding']], [true, 10500]);
});

Deno.test('munshi-tools › odd token shapes (padded, link token, number, object) → refused', async () => {
  const { deps, state } = setup();
  const link = `${FAKE_OWNER_CALL_ID}.${'A'.repeat(43)}`;
  for (
    const bad of [` ${FAKE_OWNER_CALL_ID}`, `${FAKE_OWNER_CALL_ID}\n`, link, 42, {}, [
      FAKE_OWNER_CALL_ID,
    ], null]
  ) {
    const body = await reply(
      await handleOwnerToolRequest(
        toolRequest('book_summary', { owner_call_token: bad, focus: 'overview' }),
        deps,
      ),
    );
    assertEquals(
      [body['code'], body['outstanding']],
      ['CALL_NOT_AUTHORISED', undefined],
      String(bad),
    );
  }
  assertEquals(state.events.length, 0);
});

Deno.test('munshi-tools › 10:00 after Start call still works; 1 ms later → refused', async () => {
  const at = (ms: number) => new Date(FAKE_NOW.getTime() - ms).toISOString();
  const edge = setup({ status: 'in_progress', acceptedAt: at(OWNER_TOOL_TTL_MS) });
  const past = setup({ status: 'in_progress', acceptedAt: at(OWNER_TOOL_TTL_MS + 1) });
  const ok = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), edge.deps),
  );
  const late = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), past.deps),
  );
  assertEquals([ok['ok'], late['code']], [true, 'CALL_NOT_AUTHORISED']);
});

Deno.test('munshi-tools › a refused owner call reads nothing from the book', async () => {
  const { deps } = setup({ status: 'completed' }, {
    listEntries: () => Promise.reject(new Error('must not read the book')),
  });
  const body = await reply(
    await handleOwnerToolRequest(toolRequest('book_summary', OVERVIEW), deps),
  );
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('munshi-tools › prepare → his answer → confirm over HTTP saves one credit (Build B)', async () => {
  let now = FAKE_NOW;
  const { deps, book, voice, state } = setup({}, { clock: () => now });
  const before = book.entries.length;

  const prepared = await reply(
    await handleOwnerToolRequest(
      toolRequest('prepare_credit', { ...TOKEN, name: 'Ramesh', amount: '5000' }),
      deps,
    ),
  );
  const tooSoon = await reply(
    await handleOwnerToolRequest(
      toolRequest('confirm_action', { ...TOKEN, action_ref: 'r1' }),
      deps,
    ),
  );
  // TOO_SOON dropped r1, so Munshi prepares again and reads it back before his yes.
  now = new Date(FAKE_NOW.getTime() + 1_000);
  const again = await reply(
    await handleOwnerToolRequest(
      toolRequest('prepare_credit', { ...TOKEN, name: 'Ramesh', amount: '5000' }),
      deps,
    ),
  );
  now = new Date(FAKE_NOW.getTime() + 5_000);
  const confirmed = await reply(
    await handleOwnerToolRequest(
      toolRequest('confirm_action', { ...TOKEN, action_ref: 'r2' }),
      deps,
    ),
  );

  assertEquals([prepared['ok'], prepared['action_ref']], [true, 'r1']);
  assertEquals(tooSoon['code'], 'TOO_SOON');
  assertEquals(again['action_ref'], 'r2');
  assertEquals(confirmed['code'] ?? 'ok', 'ok');
  assertEquals(book.entries.length, before + 1);
  assertEquals(voice.actions.map((action) => action.status), ['cancelled', 'saved']);
  assertEquals(state.events.map((event) => event.tool), [
    'prepare_credit',
    'confirm_action',
    'prepare_credit',
    'confirm_action',
  ]);
});

Deno.test('munshi-tools › cancel_action and every Build B tool name are known', async () => {
  const { deps } = setup();
  for (
    const tool of [
      'prepare_payment',
      'prepare_delete',
      'prepare_remind',
      'prepare_claim',
      'prepare_send',
      'cancel_action',
    ]
  ) {
    const body = await reply(await handleOwnerToolRequest(toolRequest(tool, { ...TOKEN }), deps));
    assert(body['code'] !== 'UNKNOWN_TOOL', tool);
  }
});
