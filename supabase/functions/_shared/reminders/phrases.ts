// supabase/functions/_shared/reminders/phrases.ts
// Every line of the due alert, the Remind replies, "remind all" and the score explanation, in
// English, Hindi and Telugu (the reply follows the owner's message, as in M4 Decision 8). Figures
// are digits and names stay in English letters. ⚠️ The Hindi and Telugu lines are drafts and need
// a native-speaker check before the demo (same check as M4's phrases). A missing line in any
// language is a type error. Live remind (pre-M6) rewrote `ringing` and `startedAll` in all three
// languages: those Hindi and Telugu lines are new drafts too.
import type { PrecallBlockCode } from '../compliance/precall.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export type RemindBlock = PrecallBlockCode | 'NOT_FOUND' | 'RATE_LIMITED';

export interface SkipCounts {
  readonly recent: number;
  readonly paused: number;
  readonly doNotCall: number;
  readonly notIncluded: number;
}

/** The figures on a broke-a-promise line of the due alert, already formatted. */
export interface BrokenPromiseLine {
  readonly label: string;
  readonly promised: string;
  readonly day: string;
  readonly owed: string;
}

export interface ReminderPhrases {
  readonly alertTitle: (day: string) => string;
  readonly sectionBroken: (count: number) => string;
  readonly sectionOverdue: (count: number) => string;
  readonly sectionDueToday: (count: number) => string;
  readonly brokenLine: (line: BrokenPromiseLine) => string;
  readonly overdueLine: (label: string, amount: string, days: number) => string;
  readonly dueTodayLine: (label: string, amount: string) => string;
  readonly nobodyDue: string;
  readonly pickerText: string;
  readonly remindButton: (name: string) => string;
  readonly listButton: string;
  readonly rowBroken: (owed: string) => string;
  readonly rowOverdue: (amount: string, days: number) => string;
  readonly rowDueToday: (amount: string) => string;
  readonly remindAllText: (count: number) => string;
  readonly remindAllButton: string;
  readonly ringing: (name: string) => string;
  readonly alreadyCalling: (name: string) => string;
  /** Dry-run fix 5: "call Ramesh" in natural words gets this card; only [Call] calls. */
  readonly callConfirm: (name: string) => string;
  readonly callButton: string;
  readonly callCancelled: string;
  readonly blocked: (code: RemindBlock, name: string) => string;
  readonly confirmAll: (count: number) => string;
  readonly skipped: (skips: SkipCounts) => readonly string[];
  readonly nobodyToCall: string;
  /** "Remind all": every call is simulated. */
  readonly startedAll: (count: number) => string;
  readonly notCalled: (count: number) => string;
  readonly scoreTitle: (name: string, score: number, band: string) => string;
  readonly paidOnTime: (points: number, good: number, total: number) => string;
  readonly promisesKept: (points: number, good: number, total: number) => string;
  readonly currentOverdue: (points: number, days: number) => string;
  readonly answersCalls: (points: number, good: number, total: number) => string;
  readonly nothingYet: string;
  readonly newBand: string;
}

const EN: ReminderPhrases = {
  alertTitle: (day) => `🔔 *Due alert* · ${day}`,
  sectionBroken: (count) => `*Promises missed* (${count})`,
  sectionOverdue: (count) => `*Overdue* (${count})`,
  sectionDueToday: (count) => `*Due today* (${count})`,
  brokenLine: ({ label, promised, day, owed }) =>
    `• ${label} · promised ${promised} by ${day} · owes ${owed}`,
  overdueLine: (label, amount, days) => `• ${label} · ${amount} · ${days} days overdue`,
  dueTodayLine: (label, amount) => `• ${label} · ${amount} due today`,
  nobodyDue: 'Nobody is due or overdue today.',
  pickerText: 'Tap a name to remind them. Nobody is called until you pick them.',
  remindButton: (name) => `Remind ${name}`,
  listButton: 'Remind…',
  rowBroken: (owed) => `broke a promise · owes ${owed}`,
  rowOverdue: (amount, days) => `${amount} · ${days} days overdue`,
  rowDueToday: (amount) => `${amount} due today`,
  remindAllText: (count) => `Or remind everyone due (${count} people).`,
  remindAllButton: 'Remind all due',
  ringing: (name) =>
    `📞 Calling ${name} now. It rings on the phone page (after any call already on it): answer as ${name}.`,
  alreadyCalling: (name) => `${name} is already being called.`,
  callConfirm: (name) => `📞 Call ${name} now?`,
  callButton: 'Call',
  callCancelled: 'OK, no call made.',
  blocked: (code, name) =>
    ({
      DO_NOT_CALL: `${name} asked not to be called. No call made.`,
      OUTSIDE_CALLING_HOURS: 'Calls are made only between 8 am and 7 pm. No call made.',
      ATTEMPT_LIMIT_REACHED: `${name} has had the most calls allowed for now. No call made.`,
      RATE_LIMITED: `Too many calls to ${name} just now. Please try again in a minute.`,
      NOT_FOUND: `No shopkeeper called ${name}.`,
    })[code],
  confirmAll: (count) => `Call ${count} ${count === 1 ? 'person' : 'people'}?`,
  skipped: (skips) => [
    ...(skips.recent > 0 ? [`${skips.recent} called in the last hour, skipped`] : []),
    ...(skips.paused > 0 ? [`${skips.paused} paused after a call, skipped`] : []),
    ...(skips.doNotCall > 0 ? [`${skips.doNotCall} asked not to be called, skipped`] : []),
    ...(skips.notIncluded > 0 ? [`${skips.notIncluded} more not included (10 at a time)`] : []),
  ],
  nobodyToCall:
    'Nobody to call: everyone due was called in the last hour, is paused or asked not to be called.',
  startedAll: (count) =>
    `🧪 Calling ${count} ${
      count === 1 ? 'person' : 'people'
    } with simulated calls, at most 4 at a time. Summaries will follow.`,
  notCalled: (count) => `${count} could not be called now (rules).`,
  scoreTitle: (name, score, band) => `📊 *${name}: ${score}/100* (${band})`,
  paidOnTime: (points, good, total) =>
    `Paid on time: ${points}/40 (${good} of ${total} credits paid by the due date)`,
  promisesKept: (points, good, total) =>
    `Promises kept: ${points}/30 (${good} of ${total} promises kept)`,
  currentOverdue: (points, days) => `Current overdue: ${points}/20 (${days} days overdue now)`,
  answersCalls: (points, good, total) =>
    `Answers calls: ${points}/10 (${good} of ${total} calls answered)`,
  nothingYet: 'nothing to judge yet, full marks',
  newBand: '"New": fewer than 3 credits or under 30 days of history.',
};

const HI: ReminderPhrases = {
  alertTitle: (day) => `🔔 *आज का बकाया* · ${day}`,
  sectionBroken: (count) => `*वादा टूटा* (${count})`,
  sectionOverdue: (count) => `*बकाया* (${count})`,
  sectionDueToday: (count) => `*आज देय* (${count})`,
  brokenLine: ({ label, promised, day, owed }) =>
    `• ${label} · ${day} तक ${promised} का वादा · कुल ${owed} बाकी`,
  overdueLine: (label, amount, days) => `• ${label} · ${amount} · ${days} दिन से बकाया`,
  dueTodayLine: (label, amount) => `• ${label} · आज ${amount} देय`,
  nobodyDue: 'आज किसी का कुछ देय या बकाया नहीं है।',
  pickerText: 'याद दिलाने के लिए नाम चुनें। आपके चुने बिना किसी को कॉल नहीं होगा।',
  remindButton: (name) => `${name} को याद दिलाएँ`,
  listButton: 'याद दिलाएँ…',
  rowBroken: (owed) => `वादा टूटा · ${owed} बाकी`,
  rowOverdue: (amount, days) => `${amount} · ${days} दिन से बकाया`,
  rowDueToday: (amount) => `आज ${amount} देय`,
  remindAllText: (count) => `या सबको याद दिलाएँ (${count} लोग)।`,
  remindAllButton: 'सबको याद दिलाएँ',
  ringing: (name) =>
    `📞 ${name} को अभी कॉल हो रही है। फ़ोन पेज पर घंटी बजेगी (कोई कॉल चल रही हो तो उसके बाद): ${name} बनकर जवाब दें।`,
  alreadyCalling: (name) => `${name} को पहले से कॉल हो रही है।`,
  callConfirm: (name) => `📞 ${name} को अभी कॉल करें?`,
  callButton: 'कॉल करें',
  callCancelled: 'ठीक है, कॉल नहीं की गई।',
  blocked: (code, name) =>
    ({
      DO_NOT_CALL: `${name} ने कॉल न करने को कहा है। कॉल नहीं की गई।`,
      OUTSIDE_CALLING_HOURS: 'कॉल सिर्फ़ सुबह 8 से शाम 7 बजे तक होती हैं। कॉल नहीं की गई।',
      ATTEMPT_LIMIT_REACHED: `${name} को अभी अधिकतम कॉल हो चुकी हैं। कॉल नहीं की गई।`,
      RATE_LIMITED: `${name} को अभी बहुत कॉल हुईं। एक मिनट बाद फिर कोशिश करें।`,
      NOT_FOUND: `${name} नाम का कोई दुकानदार नहीं है।`,
    })[code],
  confirmAll: (count) => `${count} लोगों को कॉल करें?`,
  skipped: (skips) => [
    ...(skips.recent > 0 ? [`${skips.recent} को पिछले घंटे कॉल हुई, छोड़े गए`] : []),
    ...(skips.paused > 0 ? [`${skips.paused} रुके हुए हैं, छोड़े गए`] : []),
    ...(skips.doNotCall > 0 ? [`${skips.doNotCall} ने कॉल न करने को कहा, छोड़े गए`] : []),
    ...(skips.notIncluded > 0 ? [`${skips.notIncluded} और शामिल नहीं (एक बार में 10)`] : []),
  ],
  nobodyToCall: 'कॉल करने को कोई नहीं: सबको पिछले घंटे कॉल हुई, वे रुके हैं, या मना किया है।',
  startedAll: (count) =>
    `🧪 ${count} लोगों को सिम्युलेटेड कॉल हो रही है, एक बार में अधिकतम 4। सारांश जल्द आएँगे।`,
  notCalled: (count) => `${count} को अभी नियमों के कारण कॉल नहीं हो सकी।`,
  scoreTitle: (name, score, band) => `📊 *${name}: ${score}/100* (${band})`,
  paidOnTime: (points, good, total) =>
    `समय पर भुगतान: ${points}/40 (${total} में से ${good} उधार समय पर चुकाए)`,
  promisesKept: (points, good, total) => `वादे निभाए: ${points}/30 (${total} में से ${good} वादे निभाए)`,
  currentOverdue: (points, days) => `अभी का बकाया: ${points}/20 (अभी ${days} दिन से बकाया)`,
  answersCalls: (points, good, total) => `कॉल उठाना: ${points}/10 (${total} में से ${good} कॉल उठाईं)`,
  nothingYet: 'अभी परखने को कुछ नहीं, पूरे अंक',
  newBand: '"नया": 3 से कम उधार या 30 दिन से कम का इतिहास।',
};

const TE: ReminderPhrases = {
  alertTitle: (day) => `🔔 *ఈరోజు బకాయిలు* · ${day}`,
  sectionBroken: (count) => `*మాట తప్పారు* (${count})`,
  sectionOverdue: (count) => `*గడువు దాటింది* (${count})`,
  sectionDueToday: (count) => `*ఈరోజు గడువు* (${count})`,
  brokenLine: ({ label, promised, day, owed }) =>
    `• ${label} · ${day} లోపు ${promised} ఇస్తానన్నారు · మొత్తం ${owed} బాకీ`,
  overdueLine: (label, amount, days) => `• ${label} · ${amount} · ${days} రోజులు ఆలస్యం`,
  dueTodayLine: (label, amount) => `• ${label} · ఈరోజు ${amount} గడువు`,
  nobodyDue: 'ఈరోజు ఎవరి బాకీ గడువు లేదు, ఆలస్యం కూడా లేదు.',
  pickerText: 'గుర్తు చేయడానికి పేరు ఎంచుకోండి. మీరు ఎంచుకునే వరకు ఎవరికీ కాల్ వెళ్ళదు.',
  remindButton: (name) => `${name}కి గుర్తుచేయి`,
  listButton: 'గుర్తుచేయి…',
  rowBroken: (owed) => `మాట తప్పారు · ${owed} బాకీ`,
  rowOverdue: (amount, days) => `${amount} · ${days} రోజులు ఆలస్యం`,
  rowDueToday: (amount) => `ఈరోజు ${amount} గడువు`,
  remindAllText: (count) => `లేదా అందరికీ గుర్తు చేయండి (${count} మంది).`,
  remindAllButton: 'అందరికీ గుర్తుచేయి',
  ringing: (name) =>
    `📞 ఇప్పుడు ${name}కి కాల్ చేస్తున్నాం. ఫోన్ పేజీలో మోగుతుంది (ఇప్పటికే కాల్ నడుస్తుంటే దాని తర్వాత): ${name}గా జవాబు ఇవ్వండి.`,
  alreadyCalling: (name) => `${name}కి ఇప్పటికే కాల్ వెళ్తోంది.`,
  callConfirm: (name) => `📞 ${name}కి ఇప్పుడు కాల్ చేయాలా?`,
  callButton: 'కాల్ చేయి',
  callCancelled: 'సరే, కాల్ చేయలేదు.',
  blocked: (code, name) =>
    ({
      DO_NOT_CALL: `${name} కాల్ చేయవద్దని చెప్పారు. కాల్ చేయలేదు.`,
      OUTSIDE_CALLING_HOURS: 'కాల్స్ ఉదయం 8 నుండి సాయంత్రం 7 వరకే. కాల్ చేయలేదు.',
      ATTEMPT_LIMIT_REACHED: `${name}కి ఇప్పటికే గరిష్ఠ కాల్స్ అయ్యాయి. కాల్ చేయలేదు.`,
      RATE_LIMITED: `${name}కి ఇప్పుడే చాలా కాల్స్ వెళ్ళాయి. ఒక నిమిషం తర్వాత ప్రయత్నించండి.`,
      NOT_FOUND: `${name} అనే షాపువారు లేరు.`,
    })[code],
  confirmAll: (count) => `${count} మందికి కాల్ చేయాలా?`,
  skipped: (skips) => [
    ...(skips.recent > 0 ? [`${skips.recent} మందికి గత గంటలో కాల్ అయింది, వదిలేశాం`] : []),
    ...(skips.paused > 0 ? [`${skips.paused} మంది ఆపి ఉంచారు, వదిలేశాం`] : []),
    ...(skips.doNotCall > 0 ? [`${skips.doNotCall} మంది కాల్ వద్దన్నారు, వదిలేశాం`] : []),
    ...(skips.notIncluded > 0 ? [`ఇంకా ${skips.notIncluded} మంది చేర్చలేదు (ఒకసారి 10)`] : []),
  ],
  nobodyToCall: 'కాల్ చేయాల్సిన వారు లేరు: అందరికీ గత గంటలో కాల్ అయింది, ఆపారు, లేదా వద్దన్నారు.',
  startedAll: (count) => `🧪 ${count} మందికి సిమ్యులేటెడ్ కాల్స్ చేస్తున్నాం, ఒకసారి గరిష్ఠంగా 4. సారాంశాలు త్వరలో వస్తాయి.`,
  notCalled: (count) => `${count} మందికి నియమాల వల్ల ఇప్పుడు కాల్ చేయలేము.`,
  scoreTitle: (name, score, band) => `📊 *${name}: ${score}/100* (${band})`,
  paidOnTime: (points, good, total) =>
    `సమయానికి చెల్లింపు: ${points}/40 (${total}లో ${good} అప్పులు గడువులోపు)`,
  promisesKept: (points, good, total) => `మాట నిలబెట్టుకున్నారు: ${points}/30 (${total}లో ${good})`,
  currentOverdue: (points, days) => `ప్రస్తుత ఆలస్యం: ${points}/20 (ఇప్పుడు ${days} రోజులు)`,
  answersCalls: (points, good, total) => `కాల్స్ ఎత్తడం: ${points}/10 (${total}లో ${good} కాల్స్ ఎత్తారు)`,
  nothingYet: 'ఇంకా చూడటానికి ఏమీ లేదు, పూర్తి మార్కులు',
  newBand: '"కొత్త": 3 కంటే తక్కువ అప్పులు లేదా 30 రోజుల కంటే తక్కువ చరిత్ర.',
};

export const REMINDER_PHRASES: Readonly<Record<Language, ReminderPhrases>> = {
  en: EN,
  hi: HI,
  te: TE,
};

export function reminderPhrasesFor(language: Language): ReminderPhrases {
  return REMINDER_PHRASES[language];
}
