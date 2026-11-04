// supabase/functions/_shared/ledger/insights-phrases.ts
// Every line of the "insights" reply and the dashboard link (M6, SPEC §6.6), in English, Hindi
// and Telugu. Figures are digits; names stay in English letters. ⚠️ All lines are drafts for
// Saim; the Hindi and Telugu ones also need the native-speaker check.
import type { Language } from '../schemas/shopkeeper.ts';

export interface InsightsPhrases {
  readonly title: (month: string) => string;
  /** The chart's caption title; null % = nothing falls due this month. */
  readonly captionTitle: (percent: number | null) => string;
  readonly collected: string;
  readonly notYetDue: string;
  readonly overdue: string;
  readonly collectedLine: (percent: number) => string;
  readonly change: (points: number) => string;
  readonly nothingThisMonth: string;
  readonly outstanding: (amount: string) => string;
  readonly topTitle: string;
  readonly daysOverdue: (days: number) => string;
  readonly noneOverdue: string;
  readonly fullDetail: (link: string) => string;
  readonly dashboardLink: (link: string) => string;
  readonly noDashboard: string;
}

/** "▲ 6 points" / "▼ 3 points" (never called with 0: each language says "same" itself). */
function arrow(points: number, unit: string): string {
  return points > 0 ? `▲ ${points} ${unit}` : `▼ ${-points} ${unit}`;
}

const EN: InsightsPhrases = {
  title: (month) => `📊 *Insights · ${month}*`,
  captionTitle: (percent) =>
    percent === null
      ? '📊 No credit falls due this month'
      : `📊 *${percent}% collected this month*`,
  collected: 'Collected',
  notYetDue: 'Not yet due',
  overdue: 'Overdue',
  collectedLine: (percent) => `Collected this month: *${percent}%*`,
  change: (points) =>
    points === 0 ? '(same as last week)' : `(${arrow(points, 'points')} vs last week)`,
  nothingThisMonth: 'No credit falls due this month yet.',
  outstanding: (amount) => `Total outstanding: *${amount}*`,
  topTitle: '*Top 5 overdue*',
  daysOverdue: (days) => `${days} days overdue`,
  noneOverdue: 'Nobody is overdue. 🎉',
  fullDetail: (link) => `Full detail: ${link}`,
  dashboardLink: (link) => `Your dashboard (the link works for 24 hours):\n${link}`,
  noDashboard: 'The dashboard is not set up yet.',
};

const HI: InsightsPhrases = {
  title: (month) => `📊 *रिपोर्ट · ${month}*`,
  captionTitle: (percent) =>
    percent === null ? '📊 इस महीने कोई उधार देय नहीं' : `📊 *इस महीने ${percent}% वसूल*`,
  collected: 'वसूल',
  notYetDue: 'अभी देय नहीं',
  overdue: 'बकाया',
  collectedLine: (percent) => `इस महीने वसूल: *${percent}%*`,
  change: (points) => points === 0 ? '(पिछले हफ़्ते जितना)' : `(पिछले हफ़्ते से ${arrow(points, 'अंक')})`,
  nothingThisMonth: 'इस महीने अभी कोई उधार देय नहीं है।',
  outstanding: (amount) => `कुल बाकी: *${amount}*`,
  topTitle: '*सबसे ज़्यादा बकाया (टॉप 5)*',
  daysOverdue: (days) => `${days} दिन बकाया`,
  noneOverdue: 'किसी का बकाया नहीं है। 🎉',
  fullDetail: (link) => `पूरी जानकारी: ${link}`,
  dashboardLink: (link) => `आपका डैशबोर्ड (लिंक 24 घंटे चलेगा):\n${link}`,
  noDashboard: 'डैशबोर्ड अभी तैयार नहीं है।',
};

const TE: InsightsPhrases = {
  title: (month) => `📊 *రిపోర్ట్ · ${month}*`,
  captionTitle: (percent) =>
    percent === null ? '📊 ఈ నెల గడువు ఉన్న అప్పు లేదు' : `📊 *ఈ నెల ${percent}% వసూలు*`,
  collected: 'వసూలైంది',
  notYetDue: 'ఇంకా గడువు రాలేదు',
  overdue: 'ఆలస్యం',
  collectedLine: (percent) => `ఈ నెల వసూలు: *${percent}%*`,
  change: (points) => points === 0 ? '(గత వారం లాగే)' : `(గత వారంతో పోలిస్తే ${arrow(points, 'పాయింట్లు')})`,
  nothingThisMonth: 'ఈ నెల ఇంకా గడువు ఉన్న అప్పు లేదు.',
  outstanding: (amount) => `మొత్తం బాకీ: *${amount}*`,
  topTitle: '*ఎక్కువ ఆలస్యం (టాప్ 5)*',
  daysOverdue: (days) => `${days} రోజులు ఆలస్యం`,
  noneOverdue: 'ఎవరూ ఆలస్యం లేరు. 🎉',
  fullDetail: (link) => `పూర్తి వివరాలు: ${link}`,
  dashboardLink: (link) => `మీ డ్యాష్‌బోర్డ్ (లింక్ 24 గంటలు పని చేస్తుంది):\n${link}`,
  noDashboard: 'డ్యాష్‌బోర్డ్ ఇంకా సిద్ధంగా లేదు.',
};

const BY_LANGUAGE: Readonly<Record<Language, InsightsPhrases>> = { en: EN, hi: HI, te: TE };

export function insightsPhrasesFor(language: Language): InsightsPhrases {
  return BY_LANGUAGE[language];
}

const LOCALES: Readonly<Record<Language, string>> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };

/** "November" / "नवंबर" / "నవంబర్" for a "2026-11" month. */
export function monthName(month: string, language: Language): string {
  const date = new Date(`${month}-15T00:00:00Z`);
  return new Intl.DateTimeFormat(LOCALES[language], { month: 'long', timeZone: 'UTC' })
    .format(date);
}
