// agent/collections/language-settings.ts
// Per-language speech settings and fixed lines. Applied when a call starts (ADR-0007).
// Deepgram nova-3 for both languages: in the M1 smoke test it handled Hinglish better
// than Azure hi-IN at about a third of the cost (ADR-0007).
import type { Variant } from '../schema.ts';

export const VARIANT_IDS = ['en', 'hi'] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

const ENGLISH_VOICE = { provider: 'azure', voiceId: 'en-IN-NeerjaNeural' } as const;
const HINDI_VOICE = { provider: 'azure', voiceId: 'hi-IN-SwaraNeural' } as const;

const HINDI_FIRST_MESSAGE =
  'नमस्ते, मैं आशा हूँ, सुविधा फ़ाइनेंस की AI असिस्टेंट। यह कॉल गुणवत्ता और नियमों के पालन के लिए रिकॉर्ड की जा रही है। यह एक छोटी टेस्ट कॉल है — आप कैसे हैं?';
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
    firstMessage:
      'Hello, this is Asha, an AI assistant calling from Suvidha Finance. This call is recorded for quality and compliance. This is a short test call — how are you today?',
    idleMessage: 'Are you still there?',
    endCallMessage: 'Thank you for your time. Goodbye!',
    endOfSpeechWaitSeconds: ENGLISH_END_OF_SPEECH_WAIT_SECONDS,
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
  },
};
