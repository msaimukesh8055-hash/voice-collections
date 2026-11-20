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

/** A run of numbers, each with an optional scale word: "13 lakh 48 thousand 500", "₹2,000". */
const CHAIN =
  /(?:₹\s*)?\d[\d,]*(?:\.\d+)?(?:\s*(?:thousand|lakhs?)\b)?(?:\s+(?:and\s+)?\d[\d,]*(?:\.\d+)?(?:\s*(?:thousand|lakhs?)\b)?)*/gi;
const PART = /(\d[\d,]*(?:\.\d+)?)(?:\s*(thousand|lakhs?)\b)?/gi;
const WORD = /[a-z]+/g;
/** Links carry ids and tokens full of digits; they are never amounts. */
const LINK = /https?:\/\/\S+/gi;

/**
 * One run of numbers as amounts. Parts join while each is smaller than the scale before it, the
 * way Indian amounts are said: "12 lakh 71 thousand" is ₹12,71,000 and "60 thousand 500" is
 * ₹60,500. "8 thousand 2 thousand" or "48000 and 10" are two amounts.
 */
function chainAmounts(chain: string): number[] {
  const found: number[] = [];
  let total: number | null = null;
  let room = Infinity;
  for (const part of chain.matchAll(PART)) {
    const scale = part[2] ? SCALES[part[2].toLowerCase()] ?? 1 : 1;
    const value = Math.round(Number((part[1] ?? '').replaceAll(',', '')) * scale);
    if (!Number.isFinite(value)) continue;
    if (total !== null && value < room) {
      total += value;
    } else {
      if (total !== null) found.push(total);
      total = value;
    }
    room = scale > 1 ? scale : 0;
  }
  if (total !== null) found.push(total);
  return found;
}

function digitAmounts(text: string): number[] {
  return [...text.matchAll(CHAIN)].flatMap((match) => chainAmounts(match[0]));
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
