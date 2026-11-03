// supabase/functions/_shared/followup/summary-phrases.ts
// Every line of the owner's after-call summary, in English, Hindi and Telugu (the owner's
// language, as in M4 Decision 8). Figures are digits; names, button labels and the agent's or
// Asha's English reasons stay as they are. ⚠️ The Hindi and Telugu lines are drafts and need a
// native-speaker check before the demo (same check as M4's phrases). A missing line in any
// language is a type error.
import type { ToneLevel } from '../calls/tone.ts';
import type { ScoreBand } from '../ledger/score.ts';
import type { PaymentMode } from '../schemas/ledger.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { NextStep, Outcome } from './rules.ts';

type StepTexts = {
  readonly [K in NextStep['kind']]: (
    step: Extract<NextStep, { kind: K }>,
    names: { readonly name: string; readonly day: string },
  ) => string;
};

export interface SummaryPhrases {
  readonly title: (name: string, shop: string) => string;
  readonly simulated: string;
  readonly outcomes: Readonly<Record<Outcome, string>>;
  readonly promise: (amount: string, day: string) => string;
  readonly claim: (amount: string, day: string, mode: string) => string;
  readonly tone: (level: ToneLevel, name: string) => string;
  readonly toneNames: Readonly<Record<ToneLevel, string>>;
  readonly next: string;
  readonly steps: StepTexts;
  readonly score: (score: number, band: string) => string;
  readonly bands: Readonly<Record<ScoreBand, string>>;
  readonly noTranscript: string;
  readonly modes: Readonly<Record<PaymentMode, string>>;
}

const MODES = { cash: 'cash', upi: 'UPI', bank_transfer: 'bank transfer', cheque: 'cheque' };

const EN: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha called ${name}* (${shop})`,
  simulated: '🧪 Simulated call',
  outcomes: {
    declined: 'Declined the call',
    no_answer: 'Did not answer',
    wrong_person: 'Someone else answered; nothing was shared',
    ended_early: 'Call ended before identity was confirmed',
    claim: 'Says already paid',
    promise: 'Promised to pay',
    callback: 'Asked you to call',
    no_promise: 'Talked; no promise',
  },
  promise: (amount, day) => `Promise: ${amount} by ${day}`,
  claim: (amount, day, mode) => `Says paid ${amount} on ${day} (${mode}). Did you receive it?`,
  tone: (level, name) => `Tone: level ${level} (${name})`,
  toneNames: { 1: 'friendly', 2: 'firm', 3: 'firmer' },
  next: 'Next',
  steps: {
    check_promise: (_step, { day }) => `Check on ${day}`,
    confirm_claim: () => 'Tap Confirm received or Not received',
    owner_callback: (step, { name }) => `Please call ${name}: ${step.reason}`,
    try_again: () => 'Try again later',
    nothing_shared: () => 'Nothing to do',
    remind_again: (step, { day }) => `Remind again on ${day}. ${step.reason}`,
    owner_should_call: (step, { name }) => `Please call ${name}. ${step.reason}`,
    pause_reminders: (step) => `Pause reminders for now. ${step.reason}`,
  },
  score: (score, band) => `Score: ${score} (${band})`,
  bands: { reliable: 'Reliable', watch: 'Watch', risky: 'Risky', new: 'New' },
  noTranscript: 'Transcript not available; summary from what the call recorded.',
  modes: MODES,
};

const HI: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha ने ${name} को कॉल किया* (${shop})`,
  simulated: '🧪 सिम्युलेटेड कॉल',
  outcomes: {
    declined: 'कॉल काट दी',
    no_answer: 'कॉल नहीं उठाई',
    wrong_person: 'किसी और ने उठाया; कुछ नहीं बताया गया',
    ended_early: 'पहचान पक्की होने से पहले कॉल कट गई',
    claim: 'कहते हैं भुगतान कर दिया',
    promise: 'भुगतान का वादा किया',
    callback: 'आपसे बात करना चाहते हैं',
    no_promise: 'बात हुई; कोई वादा नहीं',
  },
  promise: (amount, day) => `वादा: ${day} तक ${amount}`,
  claim: (amount, day, mode) => `कहते हैं ${day} को ${amount} दिए (${mode})। क्या आपको मिले?`,
  tone: (level, name) => `लहजा: स्तर ${level} (${name})`,
  toneNames: { 1: 'दोस्ताना', 2: 'सख़्त', 3: 'ज़्यादा सख़्त' },
  next: 'आगे',
  steps: {
    check_promise: (_step, { day }) => `${day} को जाँचें`,
    confirm_claim: () => 'Confirm received या Not received दबाएँ',
    owner_callback: (step, { name }) => `कृपया ${name} को कॉल करें: ${step.reason}`,
    try_again: () => 'बाद में फिर कोशिश करें',
    nothing_shared: () => 'कुछ करने की ज़रूरत नहीं',
    remind_again: (step, { day }) => `${day} को फिर याद दिलाएँ। ${step.reason}`,
    owner_should_call: (step, { name }) => `कृपया ${name} को कॉल करें। ${step.reason}`,
    pause_reminders: (step) => `अभी याद दिलाना रोकें। ${step.reason}`,
  },
  score: (score, band) => `स्कोर: ${score} (${band})`,
  bands: { reliable: 'भरोसेमंद', watch: 'नज़र रखें', risky: 'जोखिम', new: 'नया' },
  noTranscript: 'ट्रांसक्रिप्ट नहीं मिला; सारांश कॉल के रिकॉर्ड से।',
  modes: MODES,
};

const TE: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha ${name} కి కాల్ చేసింది* (${shop})`,
  simulated: '🧪 సిమ్యులేటెడ్ కాల్',
  outcomes: {
    declined: 'కాల్ కట్ చేశారు',
    no_answer: 'కాల్ ఎత్తలేదు',
    wrong_person: 'వేరే వాళ్ళు ఎత్తారు; ఏమీ చెప్పలేదు',
    ended_early: 'గుర్తింపు నిర్ధారణకు ముందే కాల్ ముగిసింది',
    claim: 'ఇప్పటికే కట్టామని చెప్పారు',
    promise: 'కడతామని మాట ఇచ్చారు',
    callback: 'మీతో మాట్లాడాలన్నారు',
    no_promise: 'మాట్లాడారు; మాట ఇవ్వలేదు',
  },
  promise: (amount, day) => `మాట: ${day} లోపు ${amount}`,
  claim: (amount, day, mode) => `${day} న ${amount} కట్టామని చెప్పారు (${mode}). మీకు అందిందా?`,
  tone: (level, name) => `తీరు: స్థాయి ${level} (${name})`,
  toneNames: { 1: 'స్నేహంగా', 2: 'గట్టిగా', 3: 'మరింత గట్టిగా' },
  next: 'తర్వాత',
  steps: {
    check_promise: (_step, { day }) => `${day} న చూడండి`,
    confirm_claim: () => 'Confirm received లేదా Not received నొక్కండి',
    owner_callback: (step, { name }) => `దయచేసి ${name} కి కాల్ చేయండి: ${step.reason}`,
    try_again: () => 'తర్వాత మళ్ళీ ప్రయత్నించండి',
    nothing_shared: () => 'ఏమీ చేయనక్కర్లేదు',
    remind_again: (step, { day }) => `${day} న మళ్ళీ గుర్తు చేయండి. ${step.reason}`,
    owner_should_call: (step, { name }) => `దయచేసి ${name} కి కాల్ చేయండి. ${step.reason}`,
    pause_reminders: (step) => `ప్రస్తుతానికి గుర్తు చేయడం ఆపండి. ${step.reason}`,
  },
  score: (score, band) => `స్కోరు: ${score} (${band})`,
  bands: { reliable: 'నమ్మకమైన', watch: 'గమనించాలి', risky: 'రిస్క్', new: 'కొత్త' },
  noTranscript: 'ట్రాన్స్‌క్రిప్ట్ అందలేదు; కాల్ రికార్డుల నుంచి సారాంశం.',
  modes: MODES,
};

const SUMMARY_PHRASES: Readonly<Record<Language, SummaryPhrases>> = { en: EN, hi: HI, te: TE };

export function summaryPhrasesFor(language: Language): SummaryPhrases {
  return SUMMARY_PHRASES[language];
}
