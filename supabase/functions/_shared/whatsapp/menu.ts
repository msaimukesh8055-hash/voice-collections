// supabase/functions/_shared/whatsapp/menu.ts
// The Menu (M7 Decision 7): one list message that opens every main action with one tap. Sent for
// "hi", "menu", "help" and the other greetings, and under "Sorry, I didn't get that". Each row is
// an mn: id that runs the same command as typing it (the router does that); "Add credit" and
// "Mark paid" only show how to say it, because the shopkeeper's name is needed.
// ⚠️ All lines are drafts for Saim (approved 2026-11-07); Hindi and Telugu need the
// native-speaker check.
import { MENU_TARGETS, menuRowId, type MenuTarget } from '../cards/ids.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from './phrases.ts';
import { blocks, type ListRow, type Reply, textIn, withEnglish } from './replies.ts';

/** The 8 rows, in the order shown (MENU_TARGETS without "menu" itself). */
export const MENU_ITEMS = MENU_TARGETS.filter(
  (item): item is Exclude<MenuTarget, 'menu'> => item !== 'menu',
);
export type MenuItem = (typeof MENU_ITEMS)[number];
/** Rows that only explain how to say it. */
export type HintItem = Extract<MenuItem, 'add' | 'paid'>;

interface Row {
  readonly title: string;
  readonly description: string;
}

interface MenuPhrases {
  readonly greeting: (name: string) => string;
  readonly choose: string;
  readonly nothingSaved: string;
  readonly listButton: string;
  readonly rows: Readonly<Record<MenuItem, Row>>;
  readonly hints: Readonly<Record<HintItem, readonly string[]>>;
}

const EN: MenuPhrases = {
  greeting: (name) => `👋 *Namaste ${name}!* I keep your credit book.`,
  choose: 'Tap *Menu* to choose, or just type or send a voice note.',
  nothingSaved: 'Nothing is saved until you tap Save.',
  listButton: 'Menu',
  rows: {
    pending: { title: '📒 Pending', description: 'Who owes you, biggest first' },
    due: { title: '🔔 Due today', description: 'Who is due or overdue, with Remind' },
    add: { title: '🧾 Add credit', description: 'How to add credit by text or voice' },
    paid: { title: '💰 Mark paid', description: 'How to record a payment' },
    closed: { title: '✅ Paid off', description: 'Cleared this month' },
    insights: { title: '📊 Insights', description: 'Pie chart, % collected, top 5' },
    dashboard: { title: '🖥️ Dashboard', description: 'Link to the web dashboard' },
    remind_all: { title: '📞 Remind all due', description: 'Asks before calling anyone' },
  },
  hints: {
    add: [
      '🧾 *Add credit*',
      'Type or say it in one line, e.g. *Ramesh 5000 due 15th*',
      "I'll show a card first. Nothing is saved until you tap Save.",
    ],
    paid: [
      '💰 *Mark paid*',
      'Type or say it, e.g. *Ramesh paid 2000*',
      "I'll show a card first. Nothing is saved until you tap Save.",
    ],
  },
};

const HI: MenuPhrases = {
  greeting: (name) => `👋 *नमस्ते ${name} जी!* मैं आपका उधार खाता रखता हूँ।`,
  choose: 'चुनने के लिए *मेनू* दबाएँ, या सीधे टाइप करें या वॉइस नोट भेजें।',
  nothingSaved: 'Save दबाने तक कुछ सेव नहीं होता।',
  listButton: 'मेनू',
  rows: {
    pending: { title: '📒 बाकी', description: 'किस पर कितना बाकी, सबसे बड़ा पहले' },
    due: { title: '🔔 आज देय', description: 'किसका देय या बकाया है, Remind के साथ' },
    add: { title: '🧾 उधार जोड़ें', description: 'टेक्स्ट या वॉइस से उधार कैसे जोड़ें' },
    paid: { title: '💰 भुगतान दर्ज करें', description: 'भुगतान कैसे दर्ज करें' },
    closed: { title: '✅ चुकता', description: 'इस महीने चुकता' },
    insights: { title: '📊 रिपोर्ट', description: 'पाई चार्ट, % वसूली, टॉप 5' },
    dashboard: { title: '🖥️ डैशबोर्ड', description: 'वेब डैशबोर्ड का लिंक' },
    remind_all: { title: '📞 सबको याद दिलाएँ', description: 'कॉल से पहले पूछेगा' },
  },
  hints: {
    add: [
      '🧾 *उधार जोड़ें*',
      'एक लाइन में टाइप करें या बोलें, जैसे *Ramesh 5000 due 15th*',
      'पहले कार्ड दिखेगा। Save दबाने तक कुछ सेव नहीं होता।',
    ],
    paid: [
      '💰 *भुगतान दर्ज करें*',
      'टाइप करें या बोलें, जैसे *Ramesh paid 2000*',
      'पहले कार्ड दिखेगा। Save दबाने तक कुछ सेव नहीं होता।',
    ],
  },
};

const TE: MenuPhrases = {
  greeting: (name) => `👋 *నమస్కారం ${name} గారు!* నేను మీ అప్పు పుస్తకం చూసుకుంటాను.`,
  choose: 'ఎంచుకోవడానికి *మెనూ* నొక్కండి, లేదా నేరుగా టైప్ చేయండి లేదా వాయిస్ నోట్ పంపండి.',
  nothingSaved: 'Save నొక్కే వరకు ఏదీ సేవ్ కాదు.',
  listButton: 'మెనూ',
  rows: {
    pending: { title: '📒 బాకీ', description: 'ఎవరు ఎంత ఇవ్వాలి, పెద్దది ముందు' },
    due: { title: '🔔 ఈరోజు గడువు', description: 'ఎవరి గడువు వచ్చింది, ఎవరు ఆలస్యం' },
    add: { title: '🧾 అప్పు జోడించు', description: 'టెక్స్ట్ లేదా వాయిస్‌తో అప్పు ఎలా జోడించాలి' },
    paid: { title: '💰 చెల్లింపు నమోదు', description: 'చెల్లింపు ఎలా నమోదు చేయాలి' },
    closed: { title: '✅ తీరినవి', description: 'ఈ నెల తీరినవి' },
    insights: { title: '📊 రిపోర్ట్', description: 'పై చార్ట్, % వసూలు, టాప్ 5' },
    dashboard: { title: '🖥️ డ్యాష్‌బోర్డ్', description: 'వెబ్ డ్యాష్‌బోర్డ్ లింక్' },
    remind_all: { title: '📞 అందరికీ గుర్తుచేయి', description: 'కాల్ చేసే ముందు అడుగుతుంది' },
  },
  hints: {
    add: [
      '🧾 *అప్పు జోడించు*',
      'ఒక లైన్‌లో టైప్ చేయండి లేదా చెప్పండి, ఉదా. *Ramesh 5000 due 15th*',
      'ముందు కార్డ్ చూపిస్తాను. Save నొక్కే వరకు ఏదీ సేవ్ కాదు.',
    ],
    paid: [
      '💰 *చెల్లింపు నమోదు*',
      'టైప్ చేయండి లేదా చెప్పండి, ఉదా. *Ramesh paid 2000*',
      'ముందు కార్డ్ చూపిస్తాను. Save నొక్కే వరకు ఏదీ సేవ్ కాదు.',
    ],
  },
};

const MENU_PHRASES: Readonly<Record<Language, MenuPhrases>> = { en: EN, hi: HI, te: TE };

export function menuPhrasesFor(language: Language): MenuPhrases {
  return MENU_PHRASES[language];
}

/** "Srinivas" from "Srinivas Reddy": the Menu greets the owner by his first name. */
function firstName(ownerName: string): string {
  return ownerName.trim().replace(/\s.*$/s, '');
}

function menuRows(language: Language): readonly ListRow[] {
  const phrases = menuPhrasesFor(language);
  return MENU_ITEMS.map((item) => ({ id: menuRowId(item, language), ...phrases.rows[item] }));
}

function menuBody(language: Language, ownerName: string): string {
  const phrases = menuPhrasesFor(language);
  return blocks(phrases.greeting(firstName(ownerName)), phrases.choose, phrases.nothingSaved);
}

/** The menu list with this body; rows and the list button stay in the owner's language. */
function menuList(
  language: Language,
  body: (language: Language) => string,
): Reply {
  const rows = menuRows(language);
  const listButton = menuPhrasesFor(language).listButton;
  return withEnglish(language, function menuIn(each): Reply {
    return { kind: 'list', text: body(each), buttonLabel: listButton, rows };
  });
}

/** The Menu, for greetings, "menu", "help" and the [📋 Menu] button. */
export function menuReply(language: Language, ownerName: string): Reply {
  return menuList(language, (each) => menuBody(each, ownerName));
}

/** "Sorry, I didn't get that." on top of the Menu. */
export function sorryMenuReply(language: Language, ownerName: string): Reply {
  return menuList(language, (each) => blocks(phrasesFor(each).sorry, menuBody(each, ownerName)));
}

/** How to add credit or record a payment by text or voice. */
export function hintReply(item: HintItem, language: Language): Reply {
  return textIn(language, (each) => blocks(...menuPhrasesFor(each).hints[item]));
}
