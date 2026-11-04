// supabase/functions/_shared/followup/summary-phrases.ts
// Every line of the owner's after-call summary, in English, Hindi and Telugu (the owner's
// language, as in M4 Decision 8). Figures are digits; names and button labels stay as they are.
// Dry-run fix 7 (2026-11-04): Result / Summary / Next / Score / Transcript, no tone line (the
// dashboard still shows it), and the agent's own sentences come in the owner's language, so no
// English is pasted into a Telugu or Hindi summary. ⚠️ The Hindi and Telugu lines are drafts and
// need a native-speaker check before the demo. A missing line in any language is a type error.
import type { ScoreBand } from '../ledger/score.ts';
import type { PaymentMode } from '../schemas/ledger.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import type { NextStep, Outcome } from './rules.ts';

/** What a next-step line can use: the shopkeeper, a date, and the agent's reason in the owner's
 * language (null when there is none in that language). */
export interface StepNames {
  readonly name: string;
  readonly day: string;
  readonly reason: string | null;
}

type StepTexts = { readonly [K in NextStep['kind']]: (names: StepNames) => string };

export interface SummaryPhrases {
  readonly title: (name: string, shop: string) => string;
  readonly simulated: string;
  readonly result: string;
  readonly outcomes: Readonly<Record<Outcome, string>>;
  readonly promise: (amount: string, day: string) => string;
  readonly claim: (amount: string, day: string, mode: string) => string;
  readonly summary: string;
  readonly next: string;
  readonly steps: StepTexts;
  readonly score: (score: number, band: string) => string;
  readonly bands: Readonly<Record<ScoreBand, string>>;
  readonly transcript: string;
  readonly noTranscript: string;
  readonly modes: Readonly<Record<PaymentMode, string>>;
}

const MODES = { cash: 'cash', upi: 'UPI', bank_transfer: 'bank transfer', cheque: 'cheque' };

/** "<text>. <reason>" when there is a reason, else just the text. */
function withReason(text: string, reason: string | null): string {
  return reason ? `${text}. ${reason}` : text;
}

const EN: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha called ${name}* (${shop})`,
  simulated: '🧪 Simulated call',
  result: 'Result',
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
  promise: (amount, day) => `Promised ${amount} by ${day}`,
  claim: (amount, day, mode) => `Says paid ${amount} on ${day} (${mode}). Did you receive it?`,
  summary: 'Summary',
  next: 'Next',
  steps: {
    check_promise: ({ day }) => `Check on ${day}`,
    confirm_claim: () => 'Tap Confirm received or Not received',
    owner_callback: ({ name, reason }) => withReason(`Please call ${name}`, reason),
    try_again: () => 'Try again later',
    nothing_shared: () => 'Nothing to do',
    remind_again: ({ day, reason }) => withReason(`Remind again on ${day}`, reason),
    owner_should_call: ({ name, reason }) => withReason(`Please call ${name}`, reason),
    pause_reminders: ({ reason }) => withReason('Pause reminders for now', reason),
  },
  score: (score, band) => `Score: ${score} (${band})`,
  bands: { reliable: 'Reliable', watch: 'Watch', risky: 'Risky', new: 'New' },
  transcript: 'Transcript',
  noTranscript: 'Transcript not available; summary from what the call recorded.',
  modes: MODES,
};

const HI: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha ने ${name} को कॉल किया* (${shop})`,
  simulated: '🧪 सिम्युलेटेड कॉल',
  result: 'नतीजा',
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
  promise: (amount, day) => `${day} तक ${amount} देने का वादा`,
  claim: (amount, day, mode) => `कहते हैं ${day} को ${amount} दिए (${mode})। क्या आपको मिले?`,
  summary: 'सारांश',
  next: 'आगे',
  steps: {
    check_promise: ({ day }) => `${day} को जाँचें`,
    confirm_claim: () => 'Confirm received या Not received दबाएँ',
    owner_callback: ({ name, reason }) => withReason(`कृपया ${name} को कॉल करें`, reason),
    try_again: () => 'बाद में फिर कोशिश करें',
    nothing_shared: () => 'कुछ करने की ज़रूरत नहीं',
    remind_again: ({ day, reason }) => withReason(`${day} को फिर याद दिलाएँ`, reason),
    owner_should_call: ({ name, reason }) => withReason(`कृपया ${name} को कॉल करें`, reason),
    pause_reminders: ({ reason }) => withReason('अभी याद दिलाना रोकें', reason),
  },
  score: (score, band) => `स्कोर: ${score} (${band})`,
  bands: { reliable: 'भरोसेमंद', watch: 'नज़र रखें', risky: 'जोखिम', new: 'नया' },
  transcript: 'बातचीत',
  noTranscript: 'ट्रांसक्रिप्ट नहीं मिला; सारांश कॉल के रिकॉर्ड से।',
  modes: MODES,
};

const TE: SummaryPhrases = {
  title: (name, shop) => `📞 *Asha ${name} కి కాల్ చేసింది* (${shop})`,
  simulated: '🧪 సిమ్యులేటెడ్ కాల్',
  result: 'ఫలితం',
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
  promise: (amount, day) => `${day} లోపు ${amount} కడతామని మాట ఇచ్చారు`,
  claim: (amount, day, mode) => `${day} న ${amount} కట్టామని చెప్పారు (${mode}). మీకు అందిందా?`,
  summary: 'సారాంశం',
  next: 'తర్వాత',
  steps: {
    check_promise: ({ day }) => `${day} న చూడండి`,
    confirm_claim: () => 'Confirm received లేదా Not received నొక్కండి',
    owner_callback: ({ name, reason }) => withReason(`దయచేసి ${name} కి కాల్ చేయండి`, reason),
    try_again: () => 'తర్వాత మళ్ళీ ప్రయత్నించండి',
    nothing_shared: () => 'ఏమీ చేయనక్కర్లేదు',
    remind_again: ({ day, reason }) => withReason(`${day} న మళ్ళీ గుర్తు చేయండి`, reason),
    owner_should_call: ({ name, reason }) => withReason(`దయచేసి ${name} కి కాల్ చేయండి`, reason),
    pause_reminders: ({ reason }) => withReason('ప్రస్తుతానికి గుర్తు చేయడం ఆపండి', reason),
  },
  score: (score, band) => `స్కోరు: ${score} (${band})`,
  bands: { reliable: 'నమ్మకమైన', watch: 'గమనించాలి', risky: 'రిస్క్', new: 'కొత్త' },
  transcript: 'సంభాషణ',
  noTranscript: 'ట్రాన్స్‌క్రిప్ట్ అందలేదు; కాల్ రికార్డుల నుంచి సారాంశం.',
  modes: MODES,
};

const SUMMARY_PHRASES: Readonly<Record<Language, SummaryPhrases>> = { en: EN, hi: HI, te: TE };

export function summaryPhrasesFor(language: Language): SummaryPhrases {
  return SUMMARY_PHRASES[language];
}
