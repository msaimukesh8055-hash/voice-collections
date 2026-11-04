// supabase/functions/_shared/cards/render.ts
// How a card looks on the owner's phone, e.g.
//   *Add credit* · Ramesh (Ramesh Kirana) · ₹5,000 · due Sun 15 Nov · Balance after: ₹13,500
//   [Save] [Edit] [Cancel]
// A payment bigger than the balance is allowed, with a warning (M4 Decision 4).
import type { BookShopkeeper } from '../db/book-repository.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Button, type Reply, withEnglish } from '../whatsapp/replies.ts';
import { cardButtonId, pickRowId } from './ids.ts';
import type { EntryPayload } from './schemas.ts';

function shopkeeperLabel(shopkeeper: BookShopkeeper): string {
  return shopkeeper.name === shopkeeper.shopName
    ? shopkeeper.name
    : `${shopkeeper.name} (${shopkeeper.shopName})`;
}

export interface EntryCardInput {
  readonly actionId: string;
  readonly shopkeeper: BookShopkeeper;
  readonly payload: EntryPayload;
  /** Balance before this entry (confirmed entries only). */
  readonly outstanding: number;
}

function amountLine(input: EntryCardInput, language: Language): string {
  const { draft } = input.payload;
  const phrases = phrasesFor(language);
  if (draft.type === 'payment' || draft.dueDate === null) return formatInr(draft.amount);
  const fallback = draft.dueDefaulted ? ` ${phrases.defaultDue}` : '';
  return `${formatInr(draft.amount)} · ${phrases.due} ${formatShortDay(draft.dueDate)}${fallback}`;
}

/** The card in the owner's language, with its English rendering for the twin (dry-run fix 4).
 * Buttons stay in the card's language. A free-text note stays as written. */
export function entryCard(input: EntryCardInput): Reply {
  const { language } = input.payload;
  const buttons = entryButtons(input.actionId, language);
  return withEnglish(
    language,
    (each) => ({ kind: 'buttons', text: entryText(input, each), buttons }),
  );
}

function entryButtons(actionId: string, language: Language): readonly Button[] {
  const phrases = phrasesFor(language);
  return [
    { id: cardButtonId(actionId, 'save'), title: phrases.save },
    { id: cardButtonId(actionId, 'edit'), title: phrases.edit },
    { id: cardButtonId(actionId, 'cancel'), title: phrases.cancel },
  ];
}

function entryText(input: EntryCardInput, language: Language): string {
  const { draft } = input.payload;
  const phrases = phrasesFor(language);
  const isCredit = draft.type === 'credit';
  const after = Math.max(0, input.outstanding + (isCredit ? draft.amount : -draft.amount));
  return blocks(
    isCredit ? phrases.addCreditTitle : phrases.paymentTitle,
    [
      shopkeeperLabel(input.shopkeeper),
      amountLine(input, language),
      ...(draft.note ? [`${phrases.note}: ${draft.note}`] : []),
    ],
    [
      `${phrases.balanceAfter}: ${formatInr(after)}`,
      ...(!isCredit && draft.amount > input.outstanding
        ? [phrases.overpaid(formatInr(input.outstanding))]
        : []),
    ],
  );
}

export function pickCard(
  actionId: string,
  input: { name: string; shopkeepers: readonly BookShopkeeper[]; language: Language },
): Reply {
  const phrases = phrasesFor(input.language);
  return {
    kind: 'list',
    text: phrases.pickPrompt(input.name),
    buttonLabel: phrases.choose,
    rows: input.shopkeepers.map((shopkeeper, index) => ({
      id: pickRowId(actionId, index),
      title: shopkeeper.name,
      description: `${shopkeeper.shopName}, ${shopkeeper.area}`,
    })),
  };
}

export function newShopkeeperCard(actionId: string, name: string, language: Language): Reply {
  const phrases = phrasesFor(language);
  return {
    kind: 'buttons',
    text: phrases.newShopkeeperQuestion(name),
    buttons: [
      { id: cardButtonId(actionId, 'yes'), title: phrases.yes },
      { id: cardButtonId(actionId, 'no'), title: phrases.no },
    ],
  };
}
