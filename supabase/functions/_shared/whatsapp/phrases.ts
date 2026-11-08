// supabase/functions/_shared/whatsapp/phrases.ts
// Every line the owner bot says, in English, Hindi and Telugu (M4 Decision 8): the reply follows
// the language of the owner's message. Figures are always digits, names stay in English letters.
// ⚠️ The Hindi and Telugu lines are drafts and must be checked by a native speaker before the
// demo (same check as Asha's greetings). A missing line in any language is a type error.
import type { Language } from '../schemas/shopkeeper.ts';
import type { HearingProblem } from '../speech/hear.ts';

export interface Phrases {
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
  /** M7: the lookup balance in short lines ("Overdue: ₹3,000 · 12 days"). */
  readonly overdueLabel: string;
  readonly nextDueLabel: string;
  readonly dayCount: (days: number) => string;
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
  /** Reply links (cloud build): under Save and a lookup, opens that customer's page. */
  readonly viewInBooks: (link: string) => string;
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
  /** M7 Decision 9: the next step after a lookup, Save and insights. */
  readonly nextFor: (name: string) => string;
  readonly remindShort: string;
  readonly paidInFull: string;
  readonly partPayment: string;
  readonly menuButton: string;
  readonly pendingButton: string;
  readonly dueButton: string;
  readonly partHint: (name: string) => string;
  readonly owesNothing: (name: string) => string;
  readonly openShopkeeper: string;
  readonly openButton: string;
}

/** Strangers' language is unknown, so this one line is English only. */
export const NOT_REGISTERED =
  'This number is not registered with Easy Recovery AI. Please contact the shop owner.';

const EN: Phrases = {
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
  pendingTitle: (people, total) => `📒 *Pending:* ${people} people owe you ${total}`,
  daysOverdue: (days) => `${days} days overdue`,
  notDueYet: 'not due yet',
  andMore: (count) => `…and ${count} more`,
  nothingPending: 'Nobody owes you anything right now.',
  closedTitle: '✅ *Paid off this month*',
  clearedOn: (day) => `cleared ${day}`,
  nothingClosed: 'No credit has been paid off this month yet.',
  balance: 'Balance',
  overdueLabel: 'Overdue',
  nextDueLabel: 'Next due',
  dayCount: (days) => `${days} days`,
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
  addCreditTitle: '🧾 *Add credit*',
  paymentTitle: '💰 *Payment received*',
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
  saved: (name, balance) => `✅ Saved. ${name} now owes ${balance}.`,
  viewInBooks: (link) => `📒 View in books: ${link}`,
  alreadySaved: 'Already saved.',
  cancelled: '✖️ Cancelled. Nothing saved.',
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
  nextFor: (name) => `What next for ${name}?`,
  remindShort: '📞 Remind',
  paidInFull: '✅ Paid in full',
  partPayment: '💰 Part payment',
  menuButton: '📋 Menu',
  pendingButton: '📒 Pending',
  dueButton: '🔔 Due today',
  partHint: (name) => `How much did ${name} pay? Send e.g. *${name} paid 2000*`,
  owesNothing: (name) => `${name} owes nothing right now.`,
  openShopkeeper: 'Tap a name to open their account.',
  openButton: 'Open…',
};

const HI: Phrases = {
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
  pendingTitle: (people, total) => `📒 *बाकी:* ${people} लोगों पर ${total} बाकी`,
  daysOverdue: (days) => `${days} दिन से बकाया`,
  notDueYet: 'अभी देय नहीं',
  andMore: (count) => `…और ${count}`,
  nothingPending: 'अभी किसी पर कुछ बाकी नहीं है।',
  closedTitle: '✅ *इस महीने चुकता*',
  clearedOn: (day) => `${day} को चुकता`,
  nothingClosed: 'इस महीने अभी तक कोई उधार चुकता नहीं हुआ।',
  balance: 'बाकी',
  overdueLabel: 'बकाया',
  nextDueLabel: 'अगला देय',
  dayCount: (days) => `${days} दिन`,
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
  addCreditTitle: '🧾 *उधार जोड़ें*',
  paymentTitle: '💰 *भुगतान मिला*',
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
  saved: (name, balance) => `✅ सेव हो गया। ${name} पर अब ${balance} बाकी।`,
  viewInBooks: (link) => `📒 खाते में देखें: ${link}`,
  alreadySaved: 'पहले ही सेव हो चुका है।',
  cancelled: '✖️ रद्द। कुछ सेव नहीं हुआ।',
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
  nextFor: (name) => `${name} के लिए आगे क्या?`,
  remindShort: '📞 याद दिलाएँ',
  paidInFull: '✅ पूरा चुकाया',
  partPayment: '💰 कुछ चुकाया',
  menuButton: '📋 मेनू',
  pendingButton: '📒 बाकी',
  dueButton: '🔔 आज देय',
  partHint: (name) => `${name} ने कितना दिया? ऐसे भेजें: *${name} paid 2000*`,
  owesNothing: (name) => `${name} पर अभी कुछ बाकी नहीं है।`,
  openShopkeeper: 'खाता खोलने के लिए नाम चुनें।',
  openButton: 'खोलें…',
};

const TE: Phrases = {
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
  pendingTitle: (people, total) => `📒 *బాకీ:* ${people} మంది ${total} ఇవ్వాలి`,
  daysOverdue: (days) => `${days} రోజులు ఆలస్యం`,
  notDueYet: 'ఇంకా గడువు రాలేదు',
  andMore: (count) => `…ఇంకా ${count}`,
  nothingPending: 'ప్రస్తుతం ఎవరూ బాకీ లేరు.',
  closedTitle: '✅ *ఈ నెల తీరినవి*',
  clearedOn: (day) => `${day} న తీరింది`,
  nothingClosed: 'ఈ నెల ఇంకా ఏ అప్పూ తీరలేదు.',
  balance: 'బాకీ',
  overdueLabel: 'ఆలస్యం',
  nextDueLabel: 'తర్వాతి గడువు',
  dayCount: (days) => `${days} రోజులు`,
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
  addCreditTitle: '🧾 *అప్పు జోడించండి*',
  paymentTitle: '💰 *చెల్లింపు అందింది*',
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
  saved: (name, balance) => `✅ సేవ్ అయింది. ${name} ఇప్పుడు ${balance} ఇవ్వాలి.`,
  viewInBooks: (link) => `📒 ఖాతాలో చూడండి: ${link}`,
  alreadySaved: 'ఇప్పటికే సేవ్ అయింది.',
  cancelled: '✖️ రద్దు చేశాం. ఏదీ సేవ్ కాలేదు.',
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
  nextFor: (name) => `${name} కి తర్వాత ఏం చేయాలి?`,
  remindShort: '📞 గుర్తుచేయి',
  paidInFull: '✅ పూర్తిగా కట్టారు',
  partPayment: '💰 కొంత కట్టారు',
  menuButton: '📋 మెనూ',
  pendingButton: '📒 బాకీ',
  dueButton: '🔔 ఈరోజు గడువు',
  partHint: (name) => `${name} ఎంత కట్టారు? ఇలా పంపండి: *${name} paid 2000*`,
  owesNothing: (name) => `${name} ప్రస్తుతం ఏమీ బాకీ లేరు.`,
  openShopkeeper: 'ఖాతా చూడటానికి పేరు ఎంచుకోండి.',
  openButton: 'చూడండి…',
};

export const PHRASES: Readonly<Record<Language, Phrases>> = { en: EN, hi: HI, te: TE };

export function phrasesFor(language: Language): Phrases {
  return PHRASES[language];
}
