// voice-agents/collections/language-settings.test.ts
import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_VARIANTS,
  RECORDING_NOTICES,
  VARIANT_IDS,
  type VariantId,
} from './language-settings.ts';

const AI_DISCLOSURE: Readonly<Record<VariantId, string>> = { en: 'AI caller', hi: 'AI कॉलर' };
const LOAN_WORDS = /loan|due|overdue|amount|₹|लोन|बकाया|रकम/i;

describe('LANGUAGE_VARIANTS', () => {
  it.each(VARIANT_IDS)('%s greeting discloses the AI caller', (id) => {
    expect(LANGUAGE_VARIANTS[id].firstMessage).toContain(AI_DISCLOSURE[id]);
  });

  it.each(VARIANT_IDS)('%s greeting asks to confirm the customer by name', (id) => {
    expect(LANGUAGE_VARIANTS[id].firstMessage).toContain('{{customerName}}');
  });

  it.each(VARIANT_IDS)(
    '%s greeting reveals nothing about the loan (could be the wrong person)',
    (id) => {
      expect(LANGUAGE_VARIANTS[id].firstMessage).not.toMatch(LOAN_WORDS);
    },
  );

  it.each(VARIANT_IDS)('%s has a recording notice that asks for a couple of minutes', (id) => {
    expect(RECORDING_NOTICES[id]).toMatch(
      id === 'en' ? /recorded.*couple of minutes/ : /रिकॉर्ड.*दो मिनट/,
    );
  });

  it('uses an Indian-English voice for English', () => {
    expect(LANGUAGE_VARIANTS.en.voice.voiceId).toMatch(/^en-IN-/);
  });

  it('uses a Hindi voice for Hindi', () => {
    expect(LANGUAGE_VARIANTS.hi.voice.voiceId).toMatch(/^hi-IN-/);
  });

  it('uses Deepgram multilingual for Hindi so Hinglish is understood', () => {
    expect(LANGUAGE_VARIANTS.hi.transcriber).toMatchObject({
      provider: 'deepgram',
      language: 'multi',
    });
  });

  it('the English call is told to write only English letters (its voice cannot read Devanagari)', () => {
    expect(LANGUAGE_VARIANTS.en.promptVariables['scriptRule']).toMatch(/never in Devanagari/);
    expect(LANGUAGE_VARIANTS.en.promptVariables['recordingNotice']).not.toMatch(/[\u0900-\u097F]/);
  });

  it.each(VARIANT_IDS)('the %s call names its own language', (id) => {
    expect(LANGUAGE_VARIANTS[id].promptVariables['callLanguage']).toBe(LANGUAGE_VARIANTS[id].label);
  });
});
