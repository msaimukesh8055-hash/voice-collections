// supabase/functions/_shared/followup/note.test.ts
// A note is always written (M5 Decision 4): from the LLM when there is a transcript, else in code.
import { assert, assertEquals } from '@std/assert';
import { CLAIM, facts, PROMISE } from './__fixtures__/facts.ts';
import { fakeLlm } from './__fixtures__/fake-llm.ts';
import {
  codeNote,
  MAX_SUMMARY_LINES,
  NOTE_EVENT,
  parseNote,
  parseSaid,
  writeNote,
} from './note.ts';
import { NOTE_PROMPT } from './prompts.ts';

const NOTE = '{"note":"Promised 2,000 by Monday; travelling till Friday, calm."}';

Deno.test('note › with a transcript, the LLM writes it', async () => {
  const { llm, calls } = fakeLlm({ [NOTE_EVENT]: [NOTE] });
  assertEquals(await writeNote(llm, facts({ promise: PROMISE })), {
    note: 'Promised 2,000 by Monday; travelling till Friday, calm.',
    source: 'sarvam',
    said: null,
  });
  assertEquals(calls[0]?.system, NOTE_PROMPT);
});

Deno.test('note › bad Sarvam JSON → Gemini; both bad → written in code', async () => {
  const gemini = await writeNote(fakeLlm({ [NOTE_EVENT]: ['meh', NOTE] }).llm, facts());
  assertEquals(gemini.source, 'gemini');
  const code = await writeNote(fakeLlm({ [NOTE_EVENT]: ['meh', '{"note":""}'] }).llm, facts());
  assertEquals(code, {
    note: 'Spoke on Mon 2 Nov; nothing was agreed.',
    source: 'code',
    said: null,
  });
});

Deno.test('note › no transcript or no answer → written in code, no LLM call', async () => {
  const { llm, calls } = fakeLlm({ [NOTE_EVENT]: [NOTE] });
  const missing = await writeNote(
    llm,
    facts({ transcript: null, transcriptMissing: true, promise: PROMISE }),
  );
  assertEquals(missing, {
    note: 'Promised ₹2,000 by Mon 9 Nov. (No transcript.)',
    source: 'code',
    said: null,
  });
  const unanswered = await writeNote(llm, facts({ connected: false }));
  assertEquals(unanswered.note, 'Did not answer the call on Mon 2 Nov.');
  assertEquals(calls.length, 0);
});

Deno.test('note › code notes for each kind of call', () => {
  assertEquals(
    codeNote(facts({ connected: false, declined: true })),
    'Declined the call on Mon 2 Nov.',
  );
  assertEquals(
    codeNote(facts({ identity: 'denied' })),
    'Someone else answered on Mon 2 Nov; nothing was shared.',
  );
  assertEquals(
    codeNote(facts({ identity: 'unknown' })),
    'The call on Mon 2 Nov ended before identity was confirmed.',
  );
  assertEquals(
    codeNote(facts({
      claim: CLAIM,
      callbacks: [{ reason: 'dispute', summary: 'Says one bill is wrong.' }],
    })),
    'Said ₹1,000 was paid on Sun 1 Nov (cash), not yet confirmed. ' +
      'Asked the owner to call: Says one bill is wrong.',
  );
});

Deno.test('note › LLM notes are cleaned to one capped line', () => {
  const long = JSON.stringify({ note: `Line one.\n\nLine   two. ${'x'.repeat(360)}` });
  assertEquals(parseNote(long)?.startsWith('Line one. Line two.'), true);
  assertEquals(parseNote(long)?.length, 240);
  assertEquals(parseNote('{"note":"' + 'x'.repeat(401) + '"}'), null);
  assertEquals(parseNote('no json'), null);
});

const V2_TE = JSON.stringify({
  note: 'Promised 2,000 by Monday; calm.',
  summary_en: ['Will pay ₹2,000 by Monday.', 'Calm.'],
  summary: ['సోమవారం లోపు ₹2,000 కడతానన్నారు.', 'Calm.'],
});

Deno.test("note v2 › summary lines in English and the owner's language; English in Telugu is dropped", async () => {
  const { llm, calls } = fakeLlm({ [NOTE_EVENT]: [V2_TE] });
  const written = await writeNote(llm, facts({ promise: PROMISE }), 'te');
  assertEquals(written.said, {
    en: ['Will pay ₹2,000 by Monday.', 'Calm.'],
    owner: ['సోమవారం లోపు ₹2,000 కడతానన్నారు.'],
  });
  assertEquals(written.note, 'Promised 2,000 by Monday; calm.');
  assert(calls[0]?.message.includes("Owner's language: Telugu"));
});

Deno.test('note v2 › English owner: the English lines serve both; at most 3, each short', () => {
  const many = JSON.stringify({ note: 'n', summary_en: ['a', 'b', 'c', 'd', 'x'.repeat(300)] });
  const said = parseSaid(many, 'en');
  assertEquals(said?.en, ['a', 'b', 'c']);
  assertEquals(said?.en.length, MAX_SUMMARY_LINES);
  assertEquals(said?.owner, ['a', 'b', 'c']);
  assertEquals(parseSaid('{"note":"n"}', 'te'), null);
  const long = parseSaid(JSON.stringify({ note: 'n', summary_en: ['x'.repeat(300)] }), 'en');
  assertEquals(long?.en[0]?.length, 160);
});

Deno.test("note v2 › prompt asks for summary_en and summary in the owner's language", () => {
  assert(NOTE_PROMPT.includes('"summary_en"') && NOTE_PROMPT.includes("owner's language"));
});
