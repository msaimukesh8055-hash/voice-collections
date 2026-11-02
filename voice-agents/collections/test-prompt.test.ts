// voice-agents/collections/test-prompt.test.ts
import { describe, expect, it } from 'vitest';
import { LANGUAGE_VARIANTS, VARIANT_IDS } from './language-settings.ts';
import { M2_TEST_PROMPT } from './test-prompt.ts';

function positionOf(text: string): number {
  const index = M2_TEST_PROMPT.indexOf(text);
  expect(index, `prompt should contain "${text}"`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('M2_TEST_PROMPT', () => {
  it('uses only per-call language variables, so one call never sees the other language', () => {
    expect(M2_TEST_PROMPT).toContain('{{recordingNotice}}');
    expect(M2_TEST_PROMPT).toContain('{{scriptRule}}');
    expect(M2_TEST_PROMPT).toContain('This call is in {{callLanguage}}');
    expect(M2_TEST_PROMPT).not.toMatch(/[\u0900-\u097F]/); // no Devanagari in the shared prompt
  });

  it.each(VARIANT_IDS)('the %s variant fills every variable the prompt uses', (id) => {
    const used = [...M2_TEST_PROMPT.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    const filled = [...Object.keys(LANGUAGE_VARIANTS[id].promptVariables), 'customerName', 'today'];
    expect(filled).toEqual(expect.arrayContaining([...new Set(used)]));
  });

  it('gives the recording notice right after the person is confirmed, before asking for the DOB', () => {
    const confirmed = positionOf('As soon as they confirm who they are');
    const notice = positionOf('{{recordingNotice}}');
    const dob = positionOf('date of birth');
    expect(confirmed).toBeLessThan(notice);
    expect(notice).toBeLessThan(dob);
  });

  it('tells Asha never to share loan details before verification', () => {
    expect(M2_TEST_PROMPT).toMatch(/Never share any loan detail until verify_customer/);
  });

  it('names every collections tool it relies on', () => {
    for (const tool of [
      'verify_customer',
      'lookup_loan',
      'log_promise_to_pay',
      'send_payment_link',
      'transfer_to_human',
    ]) {
      expect(M2_TEST_PROMPT).toContain(tool);
    }
  });

  it('uses the per-call variables for the name and today', () => {
    expect(M2_TEST_PROMPT).toContain('{{customerName}}');
    expect(M2_TEST_PROMPT).toContain('{{today}}');
  });
});

describe('M2_TEST_PROMPT › voice test fixes (2026-11-02)', () => {
  it('accepts any spoken date and never asks the caller for a format', () => {
    expect(M2_TEST_PROMPT).toMatch(/Accept the date however they say it/);
    expect(M2_TEST_PROMPT).toMatch(/Never ask the caller to use a particular format/);
  });

  it('says a wrong date "does not match" and never blames hearing', () => {
    expect(M2_TEST_PROMPT).toMatch(/does not match our records/);
    expect(M2_TEST_PROMPT).toMatch(/Never say you could not hear or understand them/);
  });

  it('never announces a tool result before it arrives', () => {
    expect(M2_TEST_PROMPT).toMatch(/Never say or guess what a tool will return/);
  });

  it('hands over to a human on the first request, before anything else', () => {
    expect(M2_TEST_PROMPT).toMatch(
      /The moment they ask for a person.*call transfer_to_human straight away/,
    );
  });
});

describe('M2_TEST_PROMPT › retest 2 fixes (2026-11-02)', () => {
  it('asks once before treating an unclear reply as a dispute', () => {
    expect(M2_TEST_PROMPT).toMatch(/If it is unclear whether they are disputing/);
    expect(M2_TEST_PROMPT).toMatch(/transfer only if they say yes/);
  });

  it('keeps listening after a handover, so the customer can change their mind', () => {
    expect(M2_TEST_PROMPT).toMatch(/Do not end the call in the same reply/);
    expect(M2_TEST_PROMPT).toMatch(/If they change their mind and want to pay, carry on/);
  });

  it('leaves the goodbye to the fixed closing line', () => {
    expect(M2_TEST_PROMPT).toMatch(/end the call without saying goodbye yourself/);
  });
});
