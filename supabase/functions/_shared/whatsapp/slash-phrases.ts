// supabase/functions/_shared/whatsapp/slash-phrases.ts
// The few new lines the "/" commands need (2026-11-08): "Who paid, and how much?"-style prompts
// when a name is needed, the short help for an unknown command, and the /claims and /promises
// titles. Every other reply is today's builder. A missing line in any language is a type error.
// ⚠️ Drafts for Saim; Hindi and Telugu need the native-speaker check.
import type { Language } from '../schemas/shopkeeper.ts';
import { type CommandName, SLASH_COMMANDS } from './slash-commands.ts';

/** Commands that need a name (or a name and an amount) when typed alone. */
export type PromptCommand = 'add' | 'paid' | 'asha' | 'statement';

export interface SlashPhrases {
  readonly prompts: Readonly<Record<PromptCommand, readonly string[]>>;
  readonly helpTitle: string;
  /** "/name · what it does", one per command, in the order registered. */
  readonly helpLines: readonly string[];
  readonly noClaims: string;
  readonly claimsTitle: (count: number, total: string) => string;
  readonly claimsNote: string;
  readonly noPromises: string;
  readonly promisesTitle: string;
  readonly weekSection: (count: number) => string;
  readonly brokenSection: (count: number) => string;
  readonly none: string;
  readonly promisedBy: (label: string, amount: string, day: string) => string;
  readonly brokenOn: (label: string, amount: string, day: string) => string;
}

type Descriptions = Readonly<Record<CommandName, string>>;

/** The help lines; English uses the registered descriptions themselves. */
function helpLines(descriptions: Descriptions | null): readonly string[] {
  return SLASH_COMMANDS.map(function helpLine(command): string {
    return `/${command.name} · ${descriptions?.[command.name] ?? command.description}`;
  });
}

const EN: SlashPhrases = {
  prompts: {
    add: [
      '🧾 *Who, how much, and due date?*',
      'Type it in one line, e.g. */add Ramesh 5000 due 15th*',
    ],
    paid: ['💰 *Who paid, and how much?*', 'Type it, e.g. */paid Ramesh 2000*'],
    asha: ['📞 *Who should Asha call?*', 'Type the name, e.g. */asha Ramesh*'],
    statement: ['👤 *Whose statement?*', 'Type the name, e.g. */statement Ramesh*'],
  },
  helpTitle: '⌨️ *Commands you can type*',
  helpLines: helpLines(null),
  noClaims: '✅ No payment claims are waiting.',
  claimsTitle: (count, total) => `💰 *Payment claims waiting: ${count}* · ${total}`,
  claimsNote: 'They count only after you tap Confirm received.',
  noPromises: '🤝 No promises fall due this week, and none was broken in the last 14 days.',
  promisesTitle: '🤝 *Promises*',
  weekSection: (count) => `*This week (${count})*`,
  brokenSection: (count) => `*Broken, last 14 days (${count})*`,
  none: 'None',
  promisedBy: (label, amount, day) => `• ${label} · ${amount} by ${day}`,
  brokenOn: (label, amount, day) => `• ${label} · ${amount} was due ${day}`,
};

const HI_DESCRIPTIONS: Descriptions = {
  munshi: 'मुंशी को कॉल करें: अपने खाते से बात करें',
  menu: 'मेनू खोलें',
  pending: 'किस पर कितना बाकी, सबसे बड़ा पहले',
  due: 'आज देय और बकाया, Remind के साथ',
  overdue: '/due जैसा: बकाया और आज देय',
  paid: 'भुगतान दर्ज करें, जैसे /paid Ramesh 2000',
  add: 'उधार जोड़ें, जैसे /add Ramesh 5000 due 15th',
  asha: 'आशा से याद दिलाने वाला कॉल, जैसे /asha Ramesh',
  reminder: '/asha जैसा: याद दिलाने वाला कॉल',
  claims: 'भुगतान के दावे जो आपकी पुष्टि का इंतज़ार कर रहे हैं',
  promises: 'इस हफ़्ते के वादे और टूटे वादे',
  insights: 'पाई चार्ट, % वसूली, टॉप 5',
  statement: 'एक दुकानदार का हिसाब, जैसे /statement Ramesh',
};

const HI: SlashPhrases = {
  prompts: {
    add: ['🧾 *किसे, कितना, और कब तक?*', 'एक लाइन में लिखें, जैसे */add Ramesh 5000 due 15th*'],
    paid: ['💰 *किसने, कितना दिया?*', 'लिखें, जैसे */paid Ramesh 2000*'],
    asha: ['📞 *आशा किसे कॉल करे?*', 'नाम लिखें, जैसे */asha Ramesh*'],
    statement: ['👤 *किसका हिसाब?*', 'नाम लिखें, जैसे */statement Ramesh*'],
  },
  helpTitle: '⌨️ *आप ये कमांड लिख सकते हैं*',
  helpLines: helpLines(HI_DESCRIPTIONS),
  noClaims: '✅ कोई भुगतान दावा बाकी नहीं है।',
  claimsTitle: (count, total) => `💰 *बाकी भुगतान दावे: ${count}* · ${total}`,
  claimsNote: 'Confirm received दबाने के बाद ही ये गिने जाते हैं।',
  noPromises: '🤝 इस हफ़्ते कोई वादा नहीं, और पिछले 14 दिनों में कोई वादा नहीं टूटा।',
  promisesTitle: '🤝 *वादे*',
  weekSection: (count) => `*इस हफ़्ते (${count})*`,
  brokenSection: (count) => `*टूटे, पिछले 14 दिन (${count})*`,
  none: 'कोई नहीं',
  promisedBy: (label, amount, day) => `• ${label} · ${amount}, ${day} तक`,
  brokenOn: (label, amount, day) => `• ${label} · ${amount}, ${day} को देय था`,
};

const TE_DESCRIPTIONS: Descriptions = {
  munshi: 'మున్షీకి కాల్: మీ పుస్తకంతో మాట్లాడండి',
  menu: 'మెనూ తెరవండి',
  pending: 'ఎవరు ఎంత ఇవ్వాలి, పెద్దది ముందు',
  due: 'ఈరోజు గడువు, ఆలస్యం, Remind తో',
  overdue: '/due లాగే: ఆలస్యం, ఈరోజు గడువు',
  paid: 'చెల్లింపు నమోదు, ఉదా. /paid Ramesh 2000',
  add: 'అప్పు జోడించు, ఉదా. /add Ramesh 5000 due 15th',
  asha: 'ఆశా గుర్తుచేసే కాల్, ఉదా. /asha Ramesh',
  reminder: '/asha లాగే: గుర్తుచేసే కాల్',
  claims: 'మీ నిర్ధారణ కోసం ఉన్న చెల్లింపు క్లెయిమ్‌లు',
  promises: 'ఈ వారం మాటలు, తప్పిన మాటలు',
  insights: 'పై చార్ట్, % వసూలు, టాప్ 5',
  statement: 'ఒక షాపు లెక్క, ఉదా. /statement Ramesh',
};

const TE: SlashPhrases = {
  prompts: {
    add: [
      '🧾 *ఎవరికి, ఎంత, ఎప్పటిలోగా?*',
      'ఒక లైన్‌లో టైప్ చేయండి, ఉదా. */add Ramesh 5000 due 15th*',
    ],
    paid: ['💰 *ఎవరు, ఎంత చెల్లించారు?*', 'టైప్ చేయండి, ఉదా. */paid Ramesh 2000*'],
    asha: ['📞 *ఆశా ఎవరికి కాల్ చేయాలి?*', 'పేరు టైప్ చేయండి, ఉదా. */asha Ramesh*'],
    statement: ['👤 *ఎవరి లెక్క?*', 'పేరు టైప్ చేయండి, ఉదా. */statement Ramesh*'],
  },
  helpTitle: '⌨️ *మీరు టైప్ చేయగల కమాండ్‌లు*',
  helpLines: helpLines(TE_DESCRIPTIONS),
  noClaims: '✅ ఏ చెల్లింపు క్లెయిమ్ వేచి లేదు.',
  claimsTitle: (count, total) => `💰 *వేచి ఉన్న చెల్లింపు క్లెయిమ్‌లు: ${count}* · ${total}`,
  claimsNote: 'Confirm received నొక్కిన తర్వాతే ఇవి లెక్కలోకి వస్తాయి.',
  noPromises: '🤝 ఈ వారం ఏ మాటా లేదు, గత 14 రోజుల్లో ఏ మాటా తప్పలేదు.',
  promisesTitle: '🤝 *మాటలు*',
  weekSection: (count) => `*ఈ వారం (${count})*`,
  brokenSection: (count) => `*తప్పినవి, గత 14 రోజులు (${count})*`,
  none: 'ఏవీ లేవు',
  promisedBy: (label, amount, day) => `• ${label} · ${amount}, ${day} లోగా`,
  brokenOn: (label, amount, day) => `• ${label} · ${amount}, ${day} న ఇవ్వాల్సింది`,
};

const PHRASES: Readonly<Record<Language, SlashPhrases>> = { en: EN, hi: HI, te: TE };

export function slashPhrasesFor(language: Language): SlashPhrases {
  return PHRASES[language];
}
