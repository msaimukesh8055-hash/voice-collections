// supabase/functions/_shared/evals/history.test.ts
// "How it got fixed": cases across runs, what changed before each run, which run fixed a case.
import { assertEquals } from '@std/assert';
import { caseHistory, type CaseOutcome, type HistoryRunInput } from './history.ts';
import { CASE_FIXES } from './case-fixes.ts';
import { PROMPT_CHANGES } from './prompt-changes.ts';
import { RUN_NOTES } from './run-notes.ts';

function run(id: string, promptHash: string, passed = false): HistoryRunInput {
  return {
    id,
    createdAt: `2026-11-2${id.length}T05:00:00Z`,
    promptHash,
    passed,
    casesPassed: 0,
    cases: 2,
    appVersion: null,
  };
}

function outcome(runId: string, scenarioId: string, pass: boolean): CaseOutcome {
  return { runId, scenarioId, name: `case ${scenarioId}`, pass };
}

// Stored newest first: r3 (new prompt) after r2 (same prompt as r1).
const RUNS = [run('r3', 'B', true), run('r2', 'A'), run('r1', 'A')];
const OUTCOMES = [
  outcome('r1', 'x-01', false),
  outcome('r2', 'x-01', false),
  outcome('r3', 'x-01', true),
  outcome('r1', 'x-02', true),
  outcome('r2', 'x-02', false),
  outcome('r3', 'x-02', true),
  outcome('r2', 'x-03', true),
];

Deno.test('history › runs oldest first; the prompt change comes from the hash', () => {
  const history = caseHistory(RUNS, OUTCOMES);
  assertEquals(
    history.runs.map((one) => [one.id, one.promptChanged, one.change]),
    [['r1', false, 'first'], ['r2', false, 'rerun'], ['r3', true, 'prompt']],
  );
});

Deno.test('history › a case that failed and now passes is fixed by the run after its last fail', () => {
  const history = caseHistory(RUNS, OUTCOMES);
  const byId = new Map(history.cases.map((one) => [one.scenarioId, one]));
  assertEquals([byId.get('x-01')?.fixedIn, byId.get('x-01')?.lastFailedIn], ['r3', 'r2']);
  assertEquals([byId.get('x-02')?.fixedIn, byId.get('x-02')?.lastFailedIn], ['r3', 'r2']);
  assertEquals(byId.get('x-03')?.fixedIn, null);
  assertEquals(byId.get('x-03')?.results, { r2: true });
});

Deno.test('history › a case failing in its latest run is not marked fixed', () => {
  const history = caseHistory(RUNS, [outcome('r1', 'x-01', true), outcome('r3', 'x-01', false)]);
  assertEquals(history.cases[0]?.fixedIn, null);
});

Deno.test('history › a written note wins over the guess, and every note is non-empty', () => {
  const [id, note] = Object.entries(RUN_NOTES)[0] ?? ['', null];
  const history = caseHistory([run(id, 'A')], []);
  assertEquals([history.runs[0]?.change, history.runs[0]?.note], [note?.kind, note?.note]);
  assertEquals(history.runs[0]?.promptName, note?.prompt ?? null);
  for (const one of Object.values(RUN_NOTES)) assertEquals(one.note.trim().length > 20, true);
});

Deno.test('history › real runs get their prompt lines and each fixed case its own note', () => {
  const v7 = { ...run('r1', 'A'), id: 'cae44fb6-d2fc-48d4-9602-6ca9256b588a' };
  const v8 = { ...run('r2', 'B'), id: '6e95f822-e81f-4b02-9605-0ec9ec7e92d0' };
  const history = caseHistory([v8, v7], [
    outcome(v7.id, 'asha-09', false),
    outcome(v8.id, 'asha-09', true),
  ], 'asha');
  const after = history.runs[1];
  assertEquals([after?.promptName, after?.promptChange?.from], ['v8', 'v7']);
  assertEquals(after?.promptChange?.added.some((line) => line.includes('Identity first')), true);
  assertEquals(history.cases[0]?.fixNote?.includes('Prompt v8'), true);
  assertEquals(caseHistory([v8, v7], [], '').runs[1]?.promptChange, null);
});

Deno.test('history › every fixed-case note and prompt change is written out', () => {
  for (const note of Object.values(CASE_FIXES)) assertEquals(note.trim().length > 20, true);
  for (const change of Object.values(PROMPT_CHANGES)) {
    assertEquals(change.added.length + change.removed.length > 0, true);
  }
});
