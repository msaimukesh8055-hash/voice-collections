// supabase/functions/_shared/brain/amounts.ts
// Rupee amounts as owners type them: "5000", "5,000", "₹5000", "Rs. 5000", "5000/-", "5k",
// "5 thousand", "2 lakh", "5 vela" (Telugu), "5 hazaar" (Hindi). Amounts are read from the text,
// never invented (ADR-0014).

/** A single credit or payment above this is treated as a typo, not a command. */
export const MAX_AMOUNT = 1_000_000;

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  thousand: 1_000,
  hazar: 1_000,
  hazaar: 1_000,
  vela: 1_000,
  veyyi: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
};

const AMOUNT = new RegExp(
  String.raw`(?:₹|\brs\.?|\binr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?` +
    String
      .raw`(?:\s*(k|thousand|hazaa?r|vela|veyyi|lakhs?)\b)?(?:\s*(?:\/-|rs\b|rupees?\b|rupaye\b))?`,
  'i',
);

export interface FoundAmount {
  readonly amount: number;
  readonly start: number;
  readonly end: number;
}

/** First amount in the text and where it is, or null when there is none (or it is absurd). */
export function findAmount(text: string): FoundAmount | null {
  const match = AMOUNT.exec(text);
  if (!match || match[1] === undefined) return null;
  const whole = Number(match[1].replaceAll(',', ''));
  const paise = match[2] === undefined ? 0 : Number(`0.${match[2]}`);
  const multiplier = MULTIPLIERS[(match[3] ?? '').toLowerCase()] ?? 1;
  const amount = Math.round((whole + paise) * multiplier * 100) / 100;
  if (amount <= 0 || amount > MAX_AMOUNT) return null;
  return { amount, start: match.index, end: match.index + match[0].length };
}

/** Every amount written in the text, in order ("Salim ne 1,000 diye" → [1000]). */
export function amountsIn(text: string): readonly number[] {
  const found: number[] = [];
  let rest = text;
  for (let next = findAmount(rest); next !== null; next = findAmount(rest)) {
    found.push(next.amount);
    rest = rest.slice(next.end);
  }
  return found;
}
