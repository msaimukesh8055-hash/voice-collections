// supabase/functions/_shared/whatsapp/phrases.ts
// Every line the owner bot says, in English, Hindi and Telugu (M4 Decision 8): the reply follows
// the language of the owner's message. Figures are always digits, names stay in English letters.
// ⚠️ The Hindi and Telugu lines are drafts and must be checked by a native speaker before the
// demo (same check as Asha's greetings). A missing line in any language is a type error.
import type { Language } from '../schemas/shopkeeper.ts';
import type { HearingProblem } from '../speech/hear.ts';

export interface Phrases {
  readonly help: string;
  readonly sorry: string;
  readonly textOnly: string;
  /** M6: the line above a voice note's reply, showing what Saaras heard. */
  readonly heard: string;
  /** M6: why a voice note was not listened to (each decided before Saaras is paid). */
  readonly voiceProblem: Readonly<Record<HearingProblem, string>>;
  readonly somethingWrong: string;
  readonly pendingTitle: (people: number, total: string) => string;
  readonly daysOverdue: (days: number) => string;
  readonly notDueYet: string;
  readonly andMore: (count: number) => string;
  readonly nothingPending: string;
  readonly closedTitle: string;
  readonly clearedOn: (day: string) => string;
  readonly nothingClosed: string;
  readonly balance: string;
  readonly overdueSince: (amount: string, days: number) => string;
  readonly nextDue: (amount: string, day: string) => string;
  readonly lastEntries: string;
  readonly credit: string;
  readonly payment: string;
  readonly due: string;
  readonly claimed: string;
  readonly rejected: string;
  readonly lastPromise: string;
  readonly noPromise: string;
  /** M6: the follow-up note from the last call, shown in the lookup. */
  readonly lastNote: string;
  readonly promiseStatus: Readonly<Record<'open' | 'kept' | 'broken' | 'replaced', string>>;
  readonly openClaims: (count: number) => string;
  readonly claimQuestion: (name: string, amount: string, day: string) => string;
  readonly addCreditTitle: string;
  readonly paymentTitle: string;
  readonly defaultDue: string;
  readonly balanceAfter: string;
  readonly overpaid: (owed: string) => string;
  readonly note: string;
  readonly save: string;
  readonly edit: string;
  readonly cancel: string;
  readonly yes: string;
  readonly no: string;
  readonly confirmReceived: string;
  readonly notReceived: string;
  readonly choose: string;
  /** Button on a "didn't answer" after-call summary (M5 Decision 4): reminds him again. */
  readonly tryAgain: string;
  readonly saved: (name: string, balance: string) => string;
  readonly alreadySaved: string;
  readonly cancelled: string;
  readonly editHint: string;
  readonly expired: string;
  readonly alreadyHandled: string;
  readonly saveFailed: string;
  readonly pickPrompt: (name: string) => string;
  readonly newShopkeeperQuestion: (name: string) => string;
  readonly newShopkeeperAdded: (name: string) => string;
  readonly notFound: (name: string) => string;
  readonly claimConfirmed: (name: string, balance: string) => string;
  readonly claimRejected: (name: string) => string;
}

/** Strangers' language is unknown, so this one line is English only. */
export const NOT_REGISTERED =
  'This number is not registered with Easy Recovery AI. Please contact the shop owner.';

const EN: Phrases = {
  help: 'Namaste! I keep your credit book.\n\n' +
    '• *pending* — who owes you\n• *closed* — paid off this month\n• *Ramesh* — one account\n' +
    '• *Ramesh 5000 due 15th* — add credit\n• *Ramesh paid 2000* — record a payment\n' +
    '• *due* — who is due or overdue\n• *remind Ramesh* — Asha calls him\n' +
    '• *remind all* — Asha calls everyone due\n• *Ramesh score* — his score explained\n\n' +
    'Nothing is saved until you tap Save.',
  sorry: "Sorry, I didn't get that.",
  textOnly: 'I can read text messages and voice notes. Please send one of those.',
  heard: '🎤 Heard',
  voiceProblem: {
    too_long:
      'That voice note is over 30 seconds. Please keep it short, e.g. "Ramesh 5000 due 15th".',
    too_big: 'That voice note is too long. Please keep it under 30 seconds.',
    not_voice: 'I can only listen to WhatsApp voice notes. Please record one, or type the message.',
    empty: "I couldn't hear anything. Please try again, a little closer to the phone.",
    failed: "Sorry, I couldn't listen to that just now. Please send it again, or type it.",
    cap: 'Voice notes are paused for today (daily limit). Please type the message.',
  },
  somethingWrong: 'Something went wrong. Please send that again.',
  pendingTitle: (people, total) => `*Pending:* ${people} people owe you ${total}`,
  daysOverdue: (days) => `${days} days overdue`,
  notDueYet: 'not due yet',
  andMore: (count) => `…and ${count} more`,
  nothingPending: 'Nobody owes you anything right now.',
  closedTitle: '*Paid off this month*',
  clearedOn: (day) => `cleared ${day}`,
  nothingClosed: 'No credit has been paid off this month yet.',
  balance: 'Balance',
  overdueSince: (amount, days) => `${amount} overdue ${days} days`,
  nextDue: (amount, day) => `next ${amount} on ${day}`,
  lastEntries: 'Last entries',
  credit: 'Credit',
  payment: 'Payment',
  due: 'due',
  claimed: '(claimed, not confirmed)',
  rejected: '(not received)',
  lastPromise: 'Last promise',
  noPromise: 'none',
  lastNote: '📝 Last call note',
  promiseStatus: { open: 'open', kept: 'kept', broken: 'broken', replaced: 'replaced' },
  openClaims: (count) => `Open claims: ${count}`,
  claimQuestion: (name, amount, day) =>
    `${name} says he paid ${amount} on ${day}. Did you receive it?`,
  addCreditTitle: '*Add credit*',
  paymentTitle: '*Payment received*',
  defaultDue: '(15 days, default)',
  balanceAfter: 'Balance after',
  overpaid: (owed) => `⚠️ More than he owes (${owed})`,
  note: 'Note',
  save: 'Save',
  edit: 'Edit',
  cancel: 'Cancel',
  yes: 'Yes',
  no: 'No',
  confirmReceived: 'Confirm received',
  notReceived: 'Not received',
  choose: 'Choose',
  tryAgain: 'Try again',
  saved: (name, balance) => `Saved. ${name} now owes ${balance}.`,
  alreadySaved: 'Already saved.',
  cancelled: 'Cancelled. Nothing saved.',
  editHint: 'Send the corrected line, e.g. *Ramesh 5000 due 20th*',
  expired: 'This card has expired. Please send it again.',
  alreadyHandled: 'Already done.',
  saveFailed: "Couldn't save. Please tap Save again.",
  pickPrompt: (name) => `Which ${name}?`,
  newShopkeeperQuestion: (name) => `Add *${name}* as a new shopkeeper?`,
  newShopkeeperAdded: (name) => `Added ${name}. You can fill in shop and area on the dashboard.`,
  notFound: (name) => `No shopkeeper called ${name}. Send *pending* to see who owes you.`,
  claimConfirmed: (name, balance) => `Confirmed. ${name} now owes ${balance}.`,
  claimRejected: (name) => `Marked not received. Asha will ask ${name} about it on the next call.`,
};

const HI: Phrases = {
  help: 'नमस्ते! मैं आपका उधार खाता रखता हूँ।\n\n' +
    '• *pending* — किसका कितना बाकी है\n• *closed* — इस महीने चुकता\n• *Ramesh* — एक खाता\n' +
    '• *Ramesh 5000 due 15th* — उधार जोड़ें\n• *Ramesh paid 2000* — भुगतान दर्ज करें\n' +
    '• *due* — किसका देय या बकाया है\n• *remind Ramesh* — Asha उन्हें कॉल करेंगी\n' +
    '• *remind all* — Asha सभी देय लोगों को कॉल करेंगी\n• *Ramesh score* — उनका स्कोर समझें\n\n' +
    'Save दबाने तक कुछ सेव नहीं होता।',
  sorry: 'माफ़ कीजिए, मैं समझ नहीं पाया।',
  textOnly: 'मैं टेक्स्ट मैसेज और वॉइस नोट समझ सकता हूँ। कृपया इनमें से एक भेजें।',
  heard: '🎤 सुना',
  voiceProblem: {
    too_long: 'यह वॉइस नोट 30 सेकंड से लंबा है। कृपया छोटा रखें, जैसे "Ramesh 5000 due 15th"।',
    too_big: 'यह वॉइस नोट बहुत लंबा है। कृपया 30 सेकंड से कम रखें।',
    not_voice: 'मैं सिर्फ़ WhatsApp वॉइस नोट सुन सकता हूँ। कृपया एक रिकॉर्ड करें, या मैसेज टाइप करें।',
    empty: 'मुझे कुछ सुनाई नहीं दिया। कृपया फ़ोन के थोड़ा पास से फिर कोशिश करें।',
    failed: 'माफ़ कीजिए, अभी मैं इसे सुन नहीं पाया। कृपया फिर भेजें, या टाइप करें।',
    cap: 'आज के लिए वॉइस नोट बंद हैं (रोज़ की सीमा)। कृपया मैसेज टाइप करें।',
  },
  somethingWrong: 'कुछ गड़बड़ हो गई। कृपया फिर से भेजें।',
  pendingTitle: (people, total) => `*बाकी:* ${people} लोगों पर ${total} बाकी`,
  daysOverdue: (days) => `${days} दिन से बकाया`,
  notDueYet: 'अभी देय नहीं',
  andMore: (count) => `…और ${count}`,
  nothingPending: 'अभी किसी पर कुछ बाकी नहीं है।',
  closedTitle: '*इस महीने चुकता*',
  clearedOn: (day) => `${day} को चुकता`,
  nothingClosed: 'इस महीने अभी तक कोई उधार चुकता नहीं हुआ।',
  balance: 'बाकी',
  overdueSince: (amount, days) => `${amount} ${days} दिन से बकाया`,
  nextDue: (amount, day) => `अगला ${amount} ${day} को`,
  lastEntries: 'पिछली एंट्री',
  credit: 'उधार',
  payment: 'भुगतान',
  due: 'देय',
  claimed: '(दावा, पुष्टि नहीं)',
  rejected: '(नहीं मिला)',
  lastPromise: 'पिछला वादा',
  noPromise: 'कोई नहीं',
  lastNote: '📝 पिछली कॉल का नोट',
  promiseStatus: { open: 'खुला', kept: 'निभाया', broken: 'टूटा', replaced: 'बदला' },
  openClaims: (count) => `खुले दावे: ${count}`,
  claimQuestion: (name, amount, day) =>
    `${name} कहते हैं उन्होंने ${day} को ${amount} दिए। क्या आपको मिले?`,
  addCreditTitle: '*उधार जोड़ें*',
  paymentTitle: '*भुगतान मिला*',
  defaultDue: '(15 दिन, अपने आप)',
  balanceAfter: 'बाद में बाकी',
  overpaid: (owed) => `⚠️ बाकी से ज़्यादा (${owed})`,
  note: 'नोट',
  save: 'Save',
  edit: 'बदलें',
  cancel: 'रद्द करें',
  yes: 'हाँ',
  no: 'नहीं',
  confirmReceived: 'मिल गया',
  notReceived: 'नहीं मिला',
  choose: 'चुनें',
  tryAgain: 'फिर से कोशिश',
  saved: (name, balance) => `सेव हो गया। ${name} पर अब ${balance} बाकी।`,
  alreadySaved: 'पहले ही सेव हो चुका है।',
  cancelled: 'रद्द। कुछ सेव नहीं हुआ।',
  editHint: 'सही लाइन भेजें, जैसे *Ramesh 5000 due 20th*',
  expired: 'यह कार्ड पुराना हो गया। कृपया फिर से भेजें।',
  alreadyHandled: 'पहले ही हो चुका है।',
  saveFailed: 'सेव नहीं हो पाया। कृपया Save फिर दबाएँ।',
  pickPrompt: (name) => `कौन से ${name}?`,
  newShopkeeperQuestion: (name) => `*${name}* को नए दुकानदार के रूप में जोड़ें?`,
  newShopkeeperAdded: (name) => `${name} जोड़ दिए गए। दुकान और इलाका डैशबोर्ड पर भरें।`,
  notFound: (name) => `${name} नाम का कोई दुकानदार नहीं। *pending* भेजें।`,
  claimConfirmed: (name, balance) => `पुष्टि हो गई। ${name} पर अब ${balance} बाकी।`,
  claimRejected: (name) => `नहीं मिला दर्ज किया। अगली कॉल पर Asha ${name} से पूछेंगी।`,
};

const TE: Phrases = {
  help: 'నమస్కారం! నేను మీ అప్పు పుస్తకం చూసుకుంటాను.\n\n' +
    '• *pending* — ఎవరు ఎంత ఇవ్వాలి\n• *closed* — ఈ నెల తీరినవి\n• *Ramesh* — ఒక ఖాతా\n' +
    '• *Ramesh 5000 due 15th* — అప్పు జోడించండి\n• *Ramesh paid 2000* — చెల్లింపు నమోదు\n' +
    '• *due* — ఎవరి గడువు వచ్చింది, ఎవరు ఆలస్యం\n• *remind Ramesh* — Asha ఆయనకు కాల్ చేస్తుంది\n' +
    '• *remind all* — గడువు వచ్చిన అందరికీ Asha కాల్ చేస్తుంది\n• *Ramesh score* — ఆయన స్కోరు వివరణ\n\n' +
    'Save నొక్కే వరకు ఏదీ సేవ్ కాదు.',
  sorry: 'క్షమించండి, నాకు అర్థం కాలేదు.',
  textOnly: 'నేను టెక్స్ట్ మెసేజ్‌లు, వాయిస్ నోట్‌లు అర్థం చేసుకోగలను. దయచేసి వాటిలో ఒకటి పంపండి.',
  heard: '🎤 విన్నది',
  voiceProblem: {
    too_long: 'ఈ వాయిస్ నోట్ 30 సెకన్ల కంటే ఎక్కువ. దయచేసి చిన్నగా చెప్పండి, ఉదా. "Ramesh 5000 due 15th".',
    too_big: 'ఈ వాయిస్ నోట్ చాలా పొడవుగా ఉంది. దయచేసి 30 సెకన్ల లోపు ఉంచండి.',
    not_voice: 'నేను WhatsApp వాయిస్ నోట్‌లు మాత్రమే వినగలను. దయచేసి ఒకటి రికార్డ్ చేయండి, లేదా మెసేజ్ టైప్ చేయండి.',
    empty: 'నాకు ఏమీ వినిపించలేదు. దయచేసి ఫోన్‌కు కొంచెం దగ్గరగా మళ్ళీ ప్రయత్నించండి.',
    failed: 'క్షమించండి, ఇప్పుడు దీన్ని వినలేకపోయాను. దయచేసి మళ్ళీ పంపండి, లేదా టైప్ చేయండి.',
    cap: 'ఈ రోజుకు వాయిస్ నోట్‌లు ఆపబడ్డాయి (రోజువారీ పరిమితి). దయచేసి మెసేజ్ టైప్ చేయండి.',
  },
  somethingWrong: 'ఏదో పొరపాటు జరిగింది. దయచేసి మళ్ళీ పంపండి.',
  pendingTitle: (people, total) => `*బాకీ:* ${people} మంది ${total} ఇవ్వాలి`,
  daysOverdue: (days) => `${days} రోజులు ఆలస్యం`,
  notDueYet: 'ఇంకా గడువు రాలేదు',
  andMore: (count) => `…ఇంకా ${count}`,
  nothingPending: 'ప్రస్తుతం ఎవరూ బాకీ లేరు.',
  closedTitle: '*ఈ నెల తీరినవి*',
  clearedOn: (day) => `${day} న తీరింది`,
  nothingClosed: 'ఈ నెల ఇంకా ఏ అప్పూ తీరలేదు.',
  balance: 'బాకీ',
  overdueSince: (amount, days) => `${amount} ${days} రోజులుగా ఆలస్యం`,
  nextDue: (amount, day) => `తర్వాత ${amount} ${day} న`,
  lastEntries: 'చివరి ఎంట్రీలు',
  credit: 'అప్పు',
  payment: 'చెల్లింపు',
  due: 'గడువు',
  claimed: '(చెప్పారు, నిర్ధారణ కాలేదు)',
  rejected: '(రాలేదు)',
  lastPromise: 'చివరి మాట',
  noPromise: 'లేదు',
  lastNote: '📝 చివరి కాల్ నోట్',
  promiseStatus: { open: 'ఉంది', kept: 'నిలబెట్టారు', broken: 'తప్పారు', replaced: 'మార్చారు' },
  openClaims: (count) => `నిర్ధారించాల్సినవి: ${count}`,
  claimQuestion: (name, amount, day) => `${name} ${day} న ${amount} కట్టానని చెప్పారు. మీకు అందిందా?`,
  addCreditTitle: '*అప్పు జోడించండి*',
  paymentTitle: '*చెల్లింపు అందింది*',
  defaultDue: '(15 రోజులు, ఆటోమేటిక్)',
  balanceAfter: 'తర్వాత బాకీ',
  overpaid: (owed) => `⚠️ బాకీ కంటే ఎక్కువ (${owed})`,
  note: 'నోట్',
  save: 'Save',
  edit: 'మార్చు',
  cancel: 'రద్దు',
  yes: 'అవును',
  no: 'వద్దు',
  confirmReceived: 'అందింది',
  notReceived: 'అందలేదు',
  choose: 'ఎంచుకోండి',
  tryAgain: 'మళ్ళీ ప్రయత్నించు',
  saved: (name, balance) => `సేవ్ అయింది. ${name} ఇప్పుడు ${balance} ఇవ్వాలి.`,
  alreadySaved: 'ఇప్పటికే సేవ్ అయింది.',
  cancelled: 'రద్దు చేశాం. ఏదీ సేవ్ కాలేదు.',
  editHint: 'సరైన లైన్ పంపండి, ఉదా. *Ramesh 5000 due 20th*',
  expired: 'ఈ కార్డ్ గడువు ముగిసింది. దయచేసి మళ్ళీ పంపండి.',
  alreadyHandled: 'ఇప్పటికే అయిపోయింది.',
  saveFailed: 'సేవ్ కాలేదు. దయచేసి Save మళ్ళీ నొక్కండి.',
  pickPrompt: (name) => `ఏ ${name}?`,
  newShopkeeperQuestion: (name) => `*${name}* ను కొత్త షాపు యజమానిగా జోడించాలా?`,
  newShopkeeperAdded: (name) => `${name} జోడించాం. షాపు, ఏరియా డాష్‌బోర్డ్‌లో నింపండి.`,
  notFound: (name) => `${name} పేరుతో ఎవరూ లేరు. *pending* పంపండి.`,
  claimConfirmed: (name, balance) => `నిర్ధారించాం. ${name} ఇప్పుడు ${balance} ఇవ్వాలి.`,
  claimRejected: (name) => `అందలేదని నమోదు చేశాం. తర్వాతి కాల్‌లో Asha ${name} ను అడుగుతుంది.`,
};

export const PHRASES: Readonly<Record<Language, Phrases>> = { en: EN, hi: HI, te: TE };

export function phrasesFor(language: Language): Phrases {
  return PHRASES[language];
}
