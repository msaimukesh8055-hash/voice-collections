// supabase/functions/_shared/calls/scorecard-amounts.ts
// Live evals (2026-11-20): the rupee amounts in a line of text, for the call scorecard. Reads
// digits ("8,000", "₹1500", "48000"), digits with a scale word ("8 thousand", "2 lakh") and
// English number words ("one thousand five hundred"). Telugu and Hindi number words are not
// read yet; the scorecard says so as a gap rather than guessing.

/** Amounts below this are counts, minutes or dates, not money. */
export const MIN_AMOUNT = 100;

const ONES: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Readonly<Record<string, number>> = {
  thousand: 1_000,
  lakh: 100_000,
  lakhs: 100_000,
};

const DIGITS =
  /(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(thousand|lakhs?)(?:\s+(?:and\s+)?(\d{1,3})(?!\d|\s*(?:thousand|lakh)))?)?/gi;
const WORD = /[a-z]+/g;
/** Links carry ids and tokens full of digits; they are never amounts. */
const LINK = /https?:\/\/\S+/gi;

function digitAmounts(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(DIGITS)) {
    const base = Number((match[1] ?? '').replaceAll(',', ''));
    const scale = match[2] ? SCALES[match[2].toLowerCase()] ?? 1 : 1;
    // "60 thousand 500" is ₹60,500, as Munshi and Asha say it.
    const rest = match[3] ? Number(match[3]) : 0;
    if (Number.isFinite(base)) found.push(Math.round(base * scale) + rest);
  }
  return found;
}

/** Runs of English number words, e.g. "one thousand five hundred" → 1500. */
function wordAmounts(text: string): number[] {
  const found: number[] = [];
  let total = 0;
  let current = 0;
  let inNumber = false;

  function close(): void {
    if (inNumber) found.push(total + current);
    total = 0;
    current = 0;
    inNumber = false;
  }

  for (const match of text.toLowerCase().matchAll(WORD)) {
    const word = match[0];
    const one = ONES[word];
    const scale = SCALES[word];
    if (one !== undefined) {
      current += one;
      inNumber = true;
    } else if (word === 'hundred' && inNumber) {
      current *= 100;
    } else if (scale !== undefined && inNumber) {
      total += current * scale;
      current = 0;
    } else if (word === 'and' && inNumber) {
      continue;
    } else {
      close();
    }
  }
  close();
  return found;
}

/** Every amount of at least MIN_AMOUNT in the text, in the order found, duplicates kept. */
export function amountsIn(text: string): number[] {
  const plain = text.replace(LINK, ' ');
  return [...digitAmounts(plain), ...wordAmounts(plain)].filter((amount) => amount >= MIN_AMOUNT);
}
