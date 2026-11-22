// supabase/functions/_shared/evals/run-notes.ts
// "How it got fixed" on the Evals page (Saim, 2026-11-22): one plain-English line per stored eval
// run saying what changed since the run before it, keyed by eval run id. Drafted by Claude from
// docs/BUILD-LOG.md, docs/milestones/M9.md and git history on 2026-11-22; the wording is Saim's
// to approve. Whether the prompt changed is never written here: the page works it out from the
// prompt hash, so a note cannot claim a prompt change that did not happen.

/**
 * first: the first run of a suite · prompt: the agent's prompt changed · code: our server or
 * parser changed, same prompt · test: our test setup or checks changed, same agent · rerun:
 * nothing changed, run again.
 */
export type RunChangeKind = 'first' | 'prompt' | 'code' | 'test' | 'rerun';

export interface RunNote {
  readonly kind: RunChangeKind;
  readonly note: string;
}

export const RUN_NOTES: Readonly<Record<string, RunNote>> = {
  // Asha (reminder calls), Sarvam Tests
  'f62a2b41-828e-4ad0-9133-ba00b78b08f0': {
    kind: 'first',
    note: 'A 2-case trial run on prompt v6, to check the test rig works end to end.',
  },
  'adfb3e8a-d2b1-4c69-8a30-28e03f9dd9e2': {
    kind: 'test',
    note:
      'First full run: all 9 cases on prompt v6. Missed: reading a part payment back (02), recording "identity denied" when the son answers (07), and hardship (08).',
  },
  'cae44fb6-d2fc-48d4-9602-6ca9256b588a': {
    kind: 'prompt',
    note:
      'Prompt v7: read a promise back in a full sentence; record "identity denied" when someone else answers; handle hardship or "stop calling" at any point. Fixed 02 and 07. The gate failed on one critical check, which turned out to be our check being wrong (next run).',
  },
  'f0f29a74-7b5e-4698-90b0-224e1b0e4da8': {
    kind: 'test',
    note:
      'Same conversations, scored again after fixing our own check: asking the owner to call back is allowed before identity (a son can ask). No prompt change. Gate passed; 08 and 09 still missed behaviours, none critical.',
  },
  '6e95f822-e81f-4b02-9605-0ec9ec7e92d0': {
    kind: 'prompt',
    note:
      'Prompt v8 (live since 12 Nov, first tested here): confirm identity before anything else; say the owner will call back. Failed: 2 critical failures (02, 03) and 08.',
  },
  '9fe48709-f619-4b94-b26f-646b70abf894': {
    kind: 'prompt',
    note:
      'Prompt v9, first draft: one point per turn; the dues tool now says "give the total alone first"; more sensitive speech detection. Fixed 02 and 03. Still missed 04 (broken promise), 05 (one long turn), 06 (owner callback) and 08 (identity).',
  },
  '4780a8ef-5f39-4823-8bca-a71647be3689': {
    kind: 'prompt',
    note:
      'Prompt v9, final: say nothing in the same reply as a tool call (those words were never spoken, which is how the callback line went missing); raise a broken promise before logging a new one; record identity before asking the owner to call back. 9/9, gate passed. Live as Sarvam version 7.',
  },
  // WhatsApp brain, checked in code
  'b92a3846-de6a-473e-ba48-433054300d3c': {
    kind: 'first',
    note:
      'First run: 21 owner messages checked in code. Two money mistakes: "Praveen gave me 1,000" read as new credit (10); "Ramesh will pay 5000 by 15th" became a money card (19).',
  },
  'fe8953fb-919b-40ce-badc-81781cbc853b': {
    kind: 'code',
    note: 'Parser fix: "X gave me N" is a payment to the owner, not new credit. Fixed 10.',
  },
  '49a4a424-5c27-457f-9d0e-25877273118f': {
    kind: 'code',
    note:
      'Code guard after the AI: a promise to pay later never becomes a money card, whatever the model suggests. Fixed 19. Gate passed 21/21.',
  },
  // Munshi (the owner's clerk), Sarvam Tests
  'ef5f8c18-979a-4cfa-b51b-8db1e982198b': {
    kind: 'first',
    note:
      'First stored run (prompt v2). 0/16 because of our test rig, not Munshi: Sarvam queued the run past the 10-minute call limit, so every test call link had expired.',
  },
  '26c48a06-0d77-4f16-b1b1-1e20175606cf': {
    kind: 'test',
    note:
      'Test rig fixed: call clocks restart every 15 s while Sarvam queues. 11/16. Three misses were our own checks (11 and 13 read the wrong field; 15 ran out of time). Two were real Munshi bugs (07, 12): it sent "confirm" together with another tool, and the confirm was lost.',
  },
  '4b336a2c-f348-43a7-a892-daa29518fbac': {
    kind: 'prompt',
    note:
      "Prompt v3: confirm on its own, never together with hanging up; read back as a question. Server: a replaced change now says plainly nothing was saved; a payment matching an open claim accepts the claim. Fixed 07. Still 11/16: Munshi still sent two tools at once (11, 12, 13); this PC's clock was 4 minutes slow (15); case 02's simulated owner asked for something else.",
  },
  'd3070d7a-851a-446a-b94c-0a82e8824225': {
    kind: 'code',
    note:
      'Same prompt v3. Server: a new read-back waits 1.5 s, so a confirm sent with it saves first; every read-back reply says "confirm on its own". Test rig takes its time from the database server; case 02 fixed to only ask. 16/16, gate passed.',
  },
};
