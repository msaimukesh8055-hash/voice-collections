// evals/sarvam/munshi.test.ts
// Munshi on Sarvam Tests (M9 Build F) with no network: the cases, the eval-owner rows, the
// translated outcome, our database checks and the suite sent to Sarvam.
import { describe, expect, it } from 'vitest';
import { OWNER_CALL_TOKEN_VARIABLE } from '../../supabase/functions/_shared/sarvam.ts';
import {
  EVAL_ENTRIES,
  RAMESH,
  RAMESH_CLAIM_ID,
  LATHA_CLAIM_ID,
  RAMESH_LAST_ENTRY_ID,
} from '../munshi/book.fixture.ts';
import { MUNSHI_SCENARIOS } from '../munshi/scenarios.ts';
import { EVAL_CITY } from './eval-data.ts';
import { MUNSHI_CASES, MUNSHI_GUARDRAILS, MUNSHI_WRAP_UP_AGO_MS } from './munshi-cases.ts';
import { checkMunshiCall, type MunshiEvidence } from './munshi-checks.ts';
import { buildMunshiEvalRows, outcomeFor } from './munshi-eval-data.ts';
import { munshiSuite } from './munshi-runner.ts';

const NOW = new Date('2026-11-15T06:00:00Z');

function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
}

function theCase(id: string): (typeof MUNSHI_CASES)[number] {
  const found = MUNSHI_CASES.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

const OPTIONS = {
  now: NOW,
  newId: counter(),
  runLabel: 'munshi-test',
  owner: { name: 'Srinivas Reddy', businessName: 'Sri Lakshmi Traders' },
};

describe('Munshi cases', () => {
  it('cover the same 15 situations as the text evals, each with written behaviours', () => {
    expect(MUNSHI_CASES.map((item) => item.id)).toEqual(
      MUNSHI_SCENARIOS.map((scenario) => `munshi-${scenario.id}`),
    );
    for (const item of MUNSHI_CASES) {
      expect(item.behaviours.length).toBeGreaterThan(0);
      expect(item.mustCall.length).toBeGreaterThan(0);
      expect(item.scenario).toContain('Srinivas Reddy');
    }
    expect(MUNSHI_GUARDRAILS).toHaveLength(4);
  });

  it('drop the due date from expected credits (the run day is real) and keep the wrap-up start', () => {
    expect(theCase('munshi-04').outcome.entries).toEqual([
      { shopkeeperId: RAMESH.id, kind: 'credit', amount: 5000 },
    ]);
    expect(theCase('munshi-15').acceptedAgoMs).toBe(MUNSHI_WRAP_UP_AGO_MS);
    expect(theCase('munshi-01').acceptedAgoMs).toBe(30_000);
  });
});

describe('Munshi eval rows', () => {
  const cases = [theCase('munshi-04'), theCase('munshi-12')];
  const rows = buildMunshiEvalRows(cases, { ...OPTIONS, newId: counter() });

  it('give every case its own flagged eval owner, fake book and live owner call', () => {
    expect(rows.owners).toHaveLength(2);
    for (const owner of rows.owners) {
      expect(owner).toMatchObject({
        city: EVAL_CITY,
        is_eval: true,
        eval_agent: 'munshi',
        eval_run: 'munshi-test',
      });
    }
    expect(rows.entries).toHaveLength(EVAL_ENTRIES.length * 2);
    expect(rows.ownerCalls[0]).toMatchObject({ status: 'accepted' });
    const ids = new Set([...rows.shopkeepers, ...rows.entries].map((row) => row['id']));
    expect(ids.size).toBe(rows.shopkeepers.length + rows.entries.length);
  });

  it('never reuse a fixture id, and keep past calls out of the follow-up queue', () => {
    const fixtureIds = new Set(EVAL_ENTRIES.map((entry) => entry.id));
    expect(rows.entries.some((row) => fixtureIds.has(String(row['id'])))).toBe(false);
    expect(rows.calls.every((row) => row['followup_status'] === 'done')).toBe(true);
    expect(rows.followups.every((row) => row['status'] === 'done')).toBe(true);
  });

  it('link the two open claims to the past Asha calls they were made on', () => {
    const claims = rows.entries.filter((row) => row['status'] === 'claimed');
    expect(claims).toHaveLength(4);
    expect(claims.every((row) => typeof row['call_id'] === 'string')).toBe(true);
  });

  it('start the owner call accepted, the wrap-up case 7 min 10 s ago', () => {
    const wrap = buildMunshiEvalRows([theCase('munshi-15')], { ...OPTIONS, newId: counter() });
    const accepted = Date.parse(String(wrap.ownerCalls[0]?.['accepted_at']));
    expect(NOW.getTime() - accepted).toBe(MUNSHI_WRAP_UP_AGO_MS);
  });
});

describe('Munshi database checks', () => {
  const evalCase = theCase('munshi-12');
  const rows = buildMunshiEvalRows([evalCase], { ...OPTIONS, newId: counter() });
  const caseRows = rows.byCase.get(evalCase.id);
  if (!caseRows) throw new Error('no rows');
  const ids = caseRows.ids;
  const outcome = outcomeFor(evalCase.outcome, ids);
  const to = (fixtureId: string): string => ids.get(fixtureId) ?? '';
  const book = EVAL_ENTRIES.map((entry) => ({
    id: to(entry.id),
    shopkeeperId: to(entry.shopkeeperId),
    kind: entry.kind,
    amount: entry.amount,
    status: entry.status as string,
  }));

  function evidence(change: (entries: typeof book) => typeof book): MunshiEvidence {
    return {
      tools: [
        { tool: 'prepare_claim', ok: true },
        { tool: 'confirm_action', ok: true },
      ],
      entries: change(book.map((entry) => ({ ...entry }))),
      savedActions: [],
    };
  }

  it('pass when the claims are settled exactly as expected and nothing else changed', () => {
    const settled = evidence((entries) =>
      entries.map((entry) => {
        if (entry.id === to(LATHA_CLAIM_ID)) return { ...entry, status: 'confirmed' };
        if (entry.id === to(RAMESH_CLAIM_ID)) return { ...entry, status: 'rejected' };
        return entry;
      }),
    );
    const checks = checkMunshiCall(evalCase, { outcome, ids }, settled);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it('fail critically when a claim is settled the wrong way, or an entry is added or reversed', () => {
    const wrong = evidence((entries) => [
      ...entries.map((entry) => {
        if (entry.id === to(LATHA_CLAIM_ID)) return { ...entry, status: 'rejected' };
        if (entry.id === to(RAMESH_LAST_ENTRY_ID)) return { ...entry, status: 'reversed' };
        return entry;
      }),
      { id: 'new', shopkeeperId: to(RAMESH.id), kind: 'credit', amount: 500, status: 'confirmed' },
    ]);
    const failed = checkMunshiCall(evalCase, { outcome, ids }, wrong).filter(
      (check) => !check.passed,
    );
    expect(failed.map((check) => [check.id, check.critical])).toEqual([
      ['outcome_entries', true],
      ['outcome_reversed', true],
      ['outcome_claims', true],
    ]);
  });

  it('count reminders and sends from saved voice actions; a missing tool is not critical', () => {
    const send = theCase('munshi-13');
    const sendRows = buildMunshiEvalRows([send], { ...OPTIONS, newId: counter() }).byCase.get(
      send.id,
    );
    if (!sendRows) throw new Error('no rows');
    const checks = checkMunshiCall(
      send,
      { outcome: outcomeFor(send.outcome, sendRows.ids), ids: sendRows.ids },
      {
        tools: [{ tool: 'prepare_send', ok: true }],
        entries: [],
        savedActions: [{ kind: 'voice_send', payload: { what: 'pending' } }],
      },
    );
    const byId = new Map(checks.map((check) => [check.id, check]));
    expect(byId.get('outcome_sends')?.passed).toBe(true);
    expect(byId.get('must_call')).toMatchObject({ passed: false, critical: false });
  });
});

describe('Munshi suite', () => {
  it('points every case at its own owner-call token', () => {
    const cases = [theCase('munshi-01'), theCase('munshi-02')];
    const rows = buildMunshiEvalRows(cases, { ...OPTIONS, newId: counter() });
    const suite = munshiSuite(
      {
        agent: { appId: 'app', appVersion: 1 },
        suiteName: 's',
        cases,
        guardrails: MUNSHI_GUARDRAILS,
        sharedVariables: [{ name: 'today', value: 'Sunday, 2026-11-15' }],
        data: OPTIONS,
      },
      rows,
    );
    const tokens = suite.test_cases.map((item) => item.variable_overrides[0]);
    expect(tokens.map((token) => token?.name)).toEqual([
      OWNER_CALL_TOKEN_VARIABLE,
      OWNER_CALL_TOKEN_VARIABLE,
    ]);
    expect(tokens[0]?.value).toBe(rows.byCase.get('munshi-01')?.ownerCallId);
    expect(tokens[0]?.value).not.toBe(tokens[1]?.value);
    expect(suite.variables.map((item) => item.name)).toContain(OWNER_CALL_TOKEN_VARIABLE);
  });
});
