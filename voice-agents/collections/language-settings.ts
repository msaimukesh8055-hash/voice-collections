// voice-agents/collections/language-settings.ts
// Per-language speech settings and fixed lines. Applied when a call starts (ADR-0007).
// Deepgram nova-3 for both languages: in the M1 smoke test it handled Hinglish better
// than Azure hi-IN at about a third of the cost (ADR-0007).
import type { Variant } from '../schema.ts';

export const VARIANT_IDS = ['en', 'hi'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

const ENGLISH_VOICE = { provider: 'azure', voiceId: 'en-IN-NeerjaNeural' } as const;
const HINDI_VOICE = { provider: 'azure', voiceId: 'hi-IN-SwaraNeural' } as const;

// "Hi, this is Asha": "I'm Asha" ran together and was heard as "I'm Marsha" (voice test).
// Greeting reveals only the company and asks for the person (M2 Decision 4): a wrong person
// hears nothing about the loan. {{customerName}} is filled per call from Vapi variableValues.
const ENGLISH_FIRST_MESSAGE =
  'Hi, this is Asha, an AI caller from Suvidha Finance. Am I speaking with {{customerName}}?';
const HINDI_FIRST_MESSAGE =
  'नमस्ते, मैं आशा हूँ, सुविधा फ़ाइनेंस से एक AI कॉलर। क्या मेरी बात {{customerName}} जी से हो रही है?';

/** Said right after the person is confirmed (RBI expectation, SPEC §9). Used by the prompt. */
export const RECORDING_NOTICES = {
  en: 'Great! Quick heads-up, this call is recorded. Can I have a couple of minutes of your time?',
  hi: 'बढ़िया! बस बता दूँ, यह कॉल रिकॉर्ड हो रही है। क्या आप मुझे दो मिनट दे सकते हैं?',
} as const satisfies Readonly<Record<VariantId, string>>;

/**
 * Which script to write replies in. The English voice cannot read Devanagari: in the voice test
 * Asha wrote a Hindi reply on an English call and the voice returned no audio, so she went
 * silent. The Hindi voice reads English words fine.
 */
const SCRIPT_RULES = {
  en:
    'Your voice can only read English letters. If you speak Hindi or Hinglish, write it in ' +
    'English letters (for example "aapka payment"), never in Devanagari script.',
  hi:
    'Write Hindi in Devanagari script. English words such as loan, UPI or EMI can stay in ' +
    'English letters.',
} as const satisfies Readonly<Record<VariantId, string>>;

const HINDI_IDLE_MESSAGE = 'क्या आप अभी भी लाइन पर हैं?';
const HINDI_END_MESSAGE = 'आपके समय के लिए धन्यवाद। नमस्ते!';

/** Vapi's default. English transcripts end in punctuation, so this wait rarely applies. */
const ENGLISH_END_OF_SPEECH_WAIT_SECONDS = 1.5;
/**
 * Hindi transcripts rarely end in punctuation, so Vapi waited the full 1.5 s every turn
 * (M1 smoke test: 2.4 s average reply). Saim chose 0.8 s; Hindi replies then averaged 1.3 s.
 */
const HINDI_END_OF_SPEECH_WAIT_SECONDS = 0.8;

export const LANGUAGE_VARIANTS: Readonly<Record<VariantId, Variant>> = {
  en: {
    language: 'en',
    label: 'English',
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'en' },
    voice: ENGLISH_VOICE,
    firstMessage: ENGLISH_FIRST_MESSAGE,
    idleMessage: 'Are you still there?',
    endCallMessage: 'Thank you for your time. Goodbye!',
    endOfSpeechWaitSeconds: ENGLISH_END_OF_SPEECH_WAIT_SECONDS,
    promptVariables: {
      callLanguage: 'English',
      recordingNotice: RECORDING_NOTICES.en,
      scriptRule: SCRIPT_RULES.en,
    },
  },
  hi: {
    language: 'hi',
    label: 'Hindi',
    // "multi" = multilingual mode, meant to handle Hindi–English mixing (Hinglish).
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
    voice: HINDI_VOICE,
    firstMessage: HINDI_FIRST_MESSAGE,
    idleMessage: HINDI_IDLE_MESSAGE,
    endCallMessage: HINDI_END_MESSAGE,
    endOfSpeechWaitSeconds: HINDI_END_OF_SPEECH_WAIT_SECONDS,
    promptVariables: {
      callLanguage: 'Hindi',
      recordingNotice: RECORDING_NOTICES.hi,
      scriptRule: SCRIPT_RULES.hi,
    },
  },
};
