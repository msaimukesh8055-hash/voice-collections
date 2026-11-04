// web/src/features/dashboard/format.ts
// Figures and labels as the dashboard shows them: rupees in Indian grouping (same as WhatsApp),
// short dates, score bands.
import { formatInr } from '@shared/format.ts';
import type { Band } from '../../lib/dashboardApi.ts';

export { formatInr };

const SHORT_DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});
const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** "5 Nov" from "2026-11-05" (a date) or an ISO timestamp. */
export function shortDate(value: string): string {
  const date = value.length === 10 ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  return SHORT_DATE.format(date);
}

export function dateTime(value: string): string {
  return DATE_TIME.format(new Date(value));
}

export const BAND_LABELS: Readonly<Record<Band, string>> = {
  reliable: 'Reliable',
  watch: 'Watch',
  risky: 'Risky',
  new: 'New',
};

const BAND_CLASSES: Readonly<Record<Band, string>> = {
  reliable: 'bg-success/10 text-success',
  watch: 'bg-warning/10 text-warning',
  risky: 'bg-danger/10 text-danger',
  new: 'bg-brand-soft text-brand',
};

export function bandClass(band: Band): string {
  return BAND_CLASSES[band];
}

/** "2 min 50 s" / "—". */
export function duration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}
