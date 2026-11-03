// supabase/functions/_shared/brain/dates.ts
// Due dates as owners type them, turned into India calendar dates from "today" (demo-clock
// aware, passed in). Rules (M4 plan): "15th" means the 15th of this month, or of next month once
// the 15th has passed; "15 Nov" is the next 15 November; "Monday" / "next Monday" is the next
// Monday after today; "in 10 days", "tomorrow". A missing date is not decided here: the card
// uses the 15-day default (DEFAULT_DUE_DAYS).
import { addDays } from '../clock.ts';

export const DEFAULT_DUE_DAYS = 15;
const DAYS_IN_WEEK = 7;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*`;
const MARKER = String.raw`(?:(?:due|by|on|before|till|until)\s+)?`;

/** English, Hindi and Telugu weekday names (Latin letters), Sunday = 0. */
const WEEKDAYS: ReadonlyArray<readonly string[]> = [
  ['sunday', 'sun', 'ravivar', 'aadivaram', 'adivaram'],
  ['monday', 'mon', 'somvar', 'somavaram'],
  ['tuesday', 'tue', 'tues', 'mangalvar', 'mangalavaram'],
  ['wednesday', 'wed', 'budhvar', 'budhavaram'],
  ['thursday', 'thu', 'thurs', 'guruvar', 'guruvaram'],
  ['friday', 'fri', 'shukravar', 'sukravaram', 'shukravaram'],
  ['saturday', 'sat', 'shanivar', 'shanivaram'],
];

export interface FoundDate {
  readonly date: string;
  readonly start: number;
  readonly end: number;
}

interface Pattern {
  readonly regex: RegExp;
  readonly toDate: (match: RegExpExecArray, today: string) => string | null;
}

function parts(today: string): { year: number; month: number; day: number } {
  return {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    day: Number(today.slice(8, 10)),
  };
}

/** YYYY-MM-DD for a day in a month (month may overflow into the next year); clamps 31 → 30. */
function dateIn(year: number, month: number, day: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const clamped = Math.min(day, lastDay.getUTCDate());
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), clamped))
    .toISOString().slice(0, 10);
}

function validDay(day: number): boolean {
  return day >= 1 && day <= 31;
}

function dayOfMonth(day: number, today: string): string | null {
  if (!validDay(day)) return null;
  const now = parts(today);
  return dateIn(now.year, day >= now.day ? now.month : now.month + 1, day);
}

function dayAndMonth(day: number, monthName: string, today: string): string | null {
  const month = MONTHS.indexOf(monthName.slice(0, 3)) + 1;
  if (!validDay(day) || month === 0) return null;
  const now = parts(today);
  const thisYear = dateIn(now.year, month, day);
  return thisYear >= today ? thisYear : dateIn(now.year + 1, month, day);
}

export function nextWeekday(name: string, today: string): string | null {
  const target = WEEKDAYS.findIndex((names) => names.includes(name));
  if (target === -1) return null;
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  const ahead = (target - current + DAYS_IN_WEEK) % DAYS_IN_WEEK || DAYS_IN_WEEK;
  return addDays(today, ahead);
}

const WEEKDAY_WORDS = WEEKDAYS.flat().join('|');

/** Most specific first: "15 nov" must not be read as "15" alone. */
const PATTERNS: readonly Pattern[] = [
  {
    regex: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    toDate: (m) => dateIn(Number(m[1]), Number(m[2]), Number(m[3])),
  },
  {
    regex: new RegExp(
      String
        .raw`(?:\bin\s+)?\b(\d{1,3})\s*(?:days?|din|dino|dinon|rojulu|rojullo|rojulo)\b(?:\s+(?:mein|me|lo)\b)?`,
    ),
    toDate: (m, today) => addDays(today, Number(m[1])),
  },
  { regex: /\b(tomorrow|kal|repu)\b/, toDate: (_m, today) => addDays(today, 1) },
  {
    regex: new RegExp(String.raw`${MARKER}\b(?:next\s+|agle\s+)?(${WEEKDAY_WORDS})\b`),
    toDate: (m, today) => nextWeekday(String(m[1]), today),
  },
  {
    regex: new RegExp(String.raw`${MARKER}\b(\d{1,2})(?:st|nd|rd|th)?\s*${MONTH}\b`),
    toDate: (m, today) => dayAndMonth(Number(m[1]), String(m[2]), today),
  },
  {
    regex: new RegExp(String.raw`${MARKER}\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b`),
    toDate: (m, today) => dayAndMonth(Number(m[2]), String(m[1]), today),
  },
  {
    regex: new RegExp(String.raw`${MARKER}\b(\d{1,2})(?:st|nd|rd|th)\b(?:\s+(?:tak|lopu|ki))?`),
    toDate: (m, today) => dayOfMonth(Number(m[1]), today),
  },
  {
    regex: /\b(?:due|by|till|until)\s+(\d{1,2})\b(?![,.\d]|\s*(?:k|thousand|hazaa?r|vela|lakh))/,
    toDate: (m, today) => dayOfMonth(Number(m[1]), today),
  },
  {
    regex: /\b(\d{1,2})\s+(?:tak|lopu)\b/,
    toDate: (m, today) => dayOfMonth(Number(m[1]), today),
  },
];

/** First due-date expression in lower-case text, or null. */
export function findDueDate(text: string, today: string): FoundDate | null {
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(text);
    const date = match ? pattern.toDate(match, today) : null;
    if (match && date) return { date, start: match.index, end: match.index + match[0].length };
  }
  return null;
}

/** The card's due date: what the owner said, or today + 15 days. */
export function dueDateOrDefault(dueDate: string | null, today: string): string {
  return dueDate ?? addDays(today, DEFAULT_DUE_DAYS);
}
