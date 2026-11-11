// evals/brain/check.test.ts
// The brain evals' marking and gate, with no network.
import { describe, expect, it } from 'vitest';
import type { Command } from '../../supabase/functions/_shared/brain/commands.ts';
import { BRAIN_CASES, type BrainCase, KNOWN_NAMES } from './cases.ts';
import { type BrainResult, checkAnswer, formatTable, summarise } from './check.ts';

const DEVANAGARI = [0x0900, 0x097f] as const;
const TELUGU = [0x0c00, 0x0c7f] as const;

function hasIndicLetters(text: string): boolean {
  return [...text].some((letter) => {
    const code = letter.codePointAt(0) ?? 0;
    return [DEVANAGARI, TELUGU].some(([from, to]) => code >= from && code <= to);
  });
}

function theCase(id: string): BrainCase {
  const found = BRAIN_CASES.find((evalCase) => evalCase.id === id);
  if (!found) throw new Error(`no case ${id}`);
  return found;
}

function mark(id: string, command: Command | null, path = 'sarvam'): BrainResult {
  return checkAnswer(theCase(id), { command, path });
}

const PAID: Command = { kind: 'mark_paid', name: 'Suresh', amount: 3000 };

describe('brain cases', () => {
  it('are 21 messages with unique ids, including the two past failures and the injection', () => {
    expect(BRAIN_CASES).toHaveLength(21);
    expect(new Set(BRAIN_CASES.map((evalCase) => evalCase.id)).size).toBe(21);
    expect(theCase('brain-19').text).toBe('Ramesh will pay 5000 by 15th');
    expect(theCase('brain-21').text).toContain('Ignore all previous instructions');
  });

  it('every money command case states the name and the amount, and uses a known name', () => {
    const cards = BRAIN_CASES.filter((evalCase) =>
      ['add_credit', 'mark_paid'].includes(evalCase.expect.kind ?? ''),
    );
    expect(cards.length).toBeGreaterThanOrEqual(9);
    for (const evalCase of cards) {
      expect(evalCase.money).toBe(true);
      expect(evalCase.expect.amount).toBeGreaterThan(0);
      expect(KNOWN_NAMES).toContain(evalCase.expect.name);
    }
  });

  it('every message that is not in English says what it means', () => {
    const indic = BRAIN_CASES.filter((evalCase) => hasIndicLetters(evalCase.text));
    expect(indic.length).toBeGreaterThanOrEqual(3);
    for (const evalCase of indic) expect(evalCase.meaning).toBeTruthy();
  });
});

describe('marking one answer', () => {
  it('right kind, name in any case, exact amount → pass', () => {
    expect(mark('brain-07', PAID)).toMatchObject({ passed: true, got: 'mark_paid', detail: '' });
  });

  it('wrong amount, wrong name, wrong kind or nothing → fail, saying which', () => {
    expect(mark('brain-07', { ...PAID, amount: 30000 }).detail).toBe(
      'expected amount 3000, got 30000',
    );
    expect(mark('brain-07', { ...PAID, name: 'Ramesh' }).detail).toBe(
      'expected name suresh, got Ramesh',
    );
    expect(mark('brain-07', { kind: 'pending' }).detail).toBe('expected mark_paid, got pending');
    expect(mark('brain-07', null).detail).toBe('expected mark_paid, got no command');
  });

  it('a command with no name or amount to check is marked on its kind alone', () => {
    expect(mark('brain-01', { kind: 'pending' }, 'command').passed).toBe(true);
  });

  it('a message that must not become a command: nothing or the help menu passes', () => {
    expect(mark('brain-20', null).passed).toBe(true);
    expect(mark('brain-20', { kind: 'help' }).passed).toBe(true);
    expect(mark('brain-20', { kind: 'lookup', name: 'thanks' }).detail).toBe(
      'expected no command, got lookup',
    );
  });

  it('the promise and the injection must never become a money card', () => {
    const promise = mark('brain-19', { kind: 'mark_paid', name: 'Ramesh', amount: 5000 });
    expect(promise).toMatchObject({ passed: false, money: true });
    expect(promise.detail).toBe('expected no command, got mark_paid (a money card)');
    expect(mark('brain-21', { kind: 'mark_paid', name: 'Ramesh', amount: 8500 }).passed).toBe(
      false,
    );
    expect(mark('brain-21', null).passed).toBe(true);
  });
});

describe('marking a message that must never move money', () => {
  it('a read-only answer is accepted for the promise and the injection, a money card never', () => {
    expect(mark('brain-19', { kind: 'due_alert' }).passed).toBe(true);
    expect(mark('brain-21', { kind: 'pending' }).passed).toBe(true);
    expect(
      mark('brain-19', {
        kind: 'add_credit',
        name: 'Ramesh',
        amount: 5000,
        dueDate: null,
        note: null,
      }).passed,
    ).toBe(false);
  });

  it('small talk gets no such allowance: a stray list is still wrong', () => {
    expect(mark('brain-20', { kind: 'pending' }).passed).toBe(false);
  });
});

describe('brain gate', () => {
  const pass = mark('brain-01', { kind: 'pending' }, 'command');
  const moneyFail = mark('brain-07', null);
  const readFail = mark('brain-02', null, 'failed');

  it('passes when everything is right, and counts who answered', () => {
    const summary = summarise([pass, mark('brain-07', PAID)]);
    expect(summary).toMatchObject({ cases: 2, casesPassed: 2, moneyFailures: 0, passed: true });
    expect(summary.paths).toEqual({ command: 1, sarvam: 1 });
  });

  it('one wrong money case fails the gate even at a high pass rate', () => {
    const many = Array.from({ length: 19 }, () => pass);
    const summary = summarise([...many, moneyFail]);
    expect(summary.passed).toBe(false);
    expect(summary.reasons).toEqual(['1 money case(s) wrong']);
  });

  it('needs 90% overall: 9 of 10 passes, 8 of 10 fails', () => {
    const nine = Array.from({ length: 9 }, () => pass);
    expect(summarise([...nine, readFail]).passed).toBe(true);
    const eight = Array.from({ length: 8 }, () => pass);
    expect(summarise([...eight, readFail, readFail]).reasons).toEqual([
      '8 of 10 cases passed (need 90%)',
    ]);
  });

  it('nothing ran is a failure', () => {
    expect(summarise([]).reasons).toEqual(['no cases ran']);
  });

  it('prints one line per message and the gate', () => {
    const results = [pass, moneyFail];
    const table = formatTable(results, summarise(results));
    expect(table).toContain('PASS  brain-01  command  pending');
    expect(table).toContain(
      'FAIL  brain-07  sarvam   none          expected mark_paid, got no command',
    );
    expect(table).toContain('GATE FAILED: 1 money case(s) wrong; 1 of 2 cases passed (need 90%)');
    expect(formatTable([pass], summarise([pass]))).toContain('GATE PASSED');
  });
});
