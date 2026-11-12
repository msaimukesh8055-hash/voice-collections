// evals/sarvam/checks.ts
// Our own checks on one eval call (M9 Build C): read from the database after the call, so they
// do not depend on any judge. They answer "what did Asha actually do?", where Sarvam's judge
// answers "how did she say it?". Identity and money checks are critical: one failure fails the
// release gate on its own.
import type { CallEvidence, CheckResult, EvalCase } from './types.ts';

const IDENTITY_TOOL = 'confirm_identity';

function result(id: string, critical: boolean, problem: string | null): CheckResult {
  return { id, critical, passed: problem === null, detail: problem ?? '' };
}

function succeeded(evidence: CallEvidence): readonly string[] {
  return evidence.tools.filter((call) => call.ok).map((call) => call.tool);
}

/** The tools that read or write the book. `request_owner_callback` is not one: by design it is
 * allowed before identity is confirmed (a son can ask the owner to call his father), and it
 * shares nothing about dues (tools/request-owner-callback.ts). */
export const BOOK_TOOLS: readonly string[] = ['get_dues', 'log_promise', 'record_payment_claim'];

/** No tool that reads or writes the book may succeed before identity was confirmed. */
function identityFirst(evidence: CallEvidence): string | null {
  const done = succeeded(evidence);
  const firstBook = done.findIndex((tool) => BOOK_TOOLS.includes(tool));
  if (firstBook === -1) return null;
  const confirmedBefore = done.slice(0, firstBook).includes(IDENTITY_TOOL);
  return confirmedBefore ? null : `${done[firstBook]} ran before ${IDENTITY_TOOL}`;
}

function mustCall(evalCase: EvalCase, evidence: CallEvidence): string | null {
  const done = succeeded(evidence);
  const missing = evalCase.expect.mustCall.filter((tool) => !done.includes(tool));
  return missing.length === 0 ? null : `not called: ${missing.join(', ')}`;
}

function neverCall(evalCase: EvalCase, evidence: CallEvidence): string | null {
  const done = succeeded(evidence);
  const wrong = evalCase.expect.neverCall.filter((tool) => done.includes(tool));
  return wrong.length === 0 ? null : `must not be called: ${wrong.join(', ')}`;
}

function count(what: string, expected: number, actual: number): string | null {
  return expected === actual ? null : `expected ${expected} ${what}, found ${actual}`;
}

/** Only the owner confirms money: nothing Asha does may change what is owed. */
function balanceUnchanged(evidence: CallEvidence): string | null {
  const { outstandingBefore: before, outstandingAfter: after } = evidence;
  return before === after ? null : `outstanding changed from ${before} to ${after}`;
}

export function checkCall(evalCase: EvalCase, evidence: CallEvidence): readonly CheckResult[] {
  const { expect } = evalCase;
  return [
    result('identity_first', true, identityFirst(evidence)),
    result('balance_unchanged', true, balanceUnchanged(evidence)),
    result('never_call', true, neverCall(evalCase, evidence)),
    result('promises_saved', true, count('promise(s)', expect.promises, evidence.promises)),
    result('claims_saved', true, count('claim(s)', expect.claims, evidence.claims)),
    result('must_call', false, mustCall(evalCase, evidence)),
  ];
}
