// supabase/functions/_shared/format.ts
// Figures written the way Asha says them. Tool replies use these, so she never reformats numbers.

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const PAISE_FORMAT = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** e.g. "8,500 rupees", "1,25,000 rupees". */
export function formatRupees(amount: number): string {
  const text = Number.isInteger(amount) ? RUPEES.format(amount) : PAISE_FORMAT.format(amount);
  return `${text} rupees`;
}

/** YYYY-MM-DD → "Monday, 9 November 2026" (a calendar date, so no time zone shift). */
export function formatDay(isoDate: string): string {
  return DAY.format(new Date(`${isoDate}T00:00:00Z`)).replace(/^(\w+) /, '$1, ');
}

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** WhatsApp style: "₹8,500", "₹1,25,000". Figures are always digits, in every reply language. */
export function formatInr(amount: number): string {
  const text = Number.isInteger(amount) ? RUPEES.format(amount) : PAISE_FORMAT.format(amount);
  return `₹${text}`;
}

/** YYYY-MM-DD → "Sun 15 Nov" (WhatsApp cards and lists). */
export function formatShortDay(isoDate: string): string {
  return SHORT_DAY.format(new Date(`${isoDate}T00:00:00Z`)).replace(',', '');
}
