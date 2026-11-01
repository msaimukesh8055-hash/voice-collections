// agent/collections/language-settings.test.ts
import { describe, expect, it } from 'vitest';
import { LANGUAGE_VARIANTS, VARIANT_IDS, type VariantId } from './language-settings.ts';

const DISCLOSURE_TERMS: Readonly<Record<VariantId, { ai: string; recorded: string }>> = {
  en: { ai: 'AI assistant', recorded: 'recorded' },
  hi: { ai: 'AI', recorded: 'रिकॉर्ड' },
};

describe('LANGUAGE_VARIANTS', () => {
  it.each(VARIANT_IDS)('%s greeting discloses the AI assistant', (id) => {
    expect(LANGUAGE_VARIANTS[id].firstMessage).toContain(DISCLOSURE_TERMS[id].ai);
  });

  it.each(VARIANT_IDS)('%s greeting includes the recording notice', (id) => {
    expect(LANGUAGE_VARIANTS[id].firstMessage).toContain(DISCLOSURE_TERMS[id].recorded);
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
});
