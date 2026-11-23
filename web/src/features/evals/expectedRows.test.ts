// web/src/features/evals/expectedRows.test.ts
// Expected vs this run (2026-11-23): golden rows matched to a stored run, the brain's expected
// vs got, and transcripts relabelled with people's names.
import type { EvalCase, GoldenCase } from '../../lib/evalsSchemas.ts';
import { brainRows, resultRows, turnsOf } from './expectedRows.ts';

function brainGolden(command: GoldenCase['command']): GoldenCase {
  return {
    id: 'brain-x',
    name: 'x',
    outcome: '',
    test: 'x',
    meaning: null,
    rows: [],
    command,
    money: true,
  };
}

function brainRun(passed: boolean, detail: string, got: EvalCase['scores']['got']): EvalCase {
  return {
    scenarioId: 'brain-x',
    scores: {
      name: 'x',
      category: 'money',
      verdicts: [],
      checks: [{ id: 'understood_as_add_credit', critical: true, passed, detail }],
      got,
    },
    transcript: '',
    pass: passed,
  };
}

const ADD = { kind: 'add_credit', name: 'ramesh', amount: 5000, readsAllowed: false };

describe('brainRows', () => {
  it('a wrong command fails the command row; name and amount were never compared', () => {
    const rows = brainRows(
      brainGolden({ ...ADD, kind: 'mark_paid' }),
      brainRun(false, 'expected mark_paid, got add_credit', null),
    );
    expect(rows.map((row) => `${row.label} ${row.got} ${row.status}`)).toEqual([
      'Command add_credit fail',
      'Name not saved in this run not_checked',
      'Amount not saved in this run not_checked',
    ]);
  });

  it('uses what the brain answered when the run stored it', () => {
    const rows = brainRows(
      brainGolden(ADD),
      brainRun(false, 'expected name ramesh, got Suresh', {
        kind: 'add_credit',
        name: 'Suresh',
        amount: 5000,
      }),
    );
    expect(rows.map((row) => `${row.label} ${row.got} ${row.status}`)).toEqual([
      'Command add_credit pass',
      'Name Suresh fail',
      'Amount 5000 not_checked',
    ]);
  });

  it('"no money card" passes with a read-only answer', () => {
    const run = brainRun(true, '', null);
    const rows = brainRows(
      brainGolden({ kind: null, name: null, amount: null, readsAllowed: true }),
      {
        ...run,
        scores: {
          ...run.scores,
          checks: [{ id: 'understood_as_pending', critical: true, passed: true, detail: '' }],
        },
      },
    );
    expect(rows).toEqual([
      { label: 'Command', expected: 'no money card', got: 'pending', status: 'pass' },
    ]);
  });
});

describe('resultRows', () => {
  it('keeps checks an older run stored that today’s case no longer lists', () => {
    const golden: GoldenCase = { ...brainGolden(null), rows: [] };
    const run = brainRun(false, 'gone', null);
    expect(resultRows(golden, run)).toEqual([
      {
        label: 'understood_as_add_credit',
        expected: 'Not in today’s case (older run)',
        checkedBy: 'code',
        blocker: true,
        status: 'fail',
        note: 'gone',
      },
    ]);
  });
});

describe('turnsOf', () => {
  it('names the agent and the simulated caller; a line without a role continues the turn', () => {
    expect(turnsOf('assistant: Hello\nuser: Hi\nstill me', 'Munshi')).toEqual([
      { speaker: 'Munshi', fromAgent: true, text: 'Hello' },
      { speaker: 'Simulated caller', fromAgent: false, text: 'Hi\nstill me' },
    ]);
  });
});
