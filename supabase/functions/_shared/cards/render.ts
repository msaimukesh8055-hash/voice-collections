// supabase/functions/_shared/cards/render.ts
// How a card looks on the owner's phone, e.g.
//   *Add credit* · Ramesh (Ramesh Kirana) · ₹5,000 · due Sun 15 Nov · Balance after: ₹13,500
//   [Save] [Edit] [Cancel]
// A payment bigger than the balance is allowed, with a warning (M4 Decision 4).
import type { BookShopkeeper } from '../db/book-repository.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Reply } from '../whatsapp/replies.ts';
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

function amountLine(input: EntryCardInput): string {
  const { draft, language } = input.payload;
  const phrases = phrasesFor(language);
  if (draft.type === 'payment' || draft.dueDate === null) return formatInr(draft.amount);
  const fallback = draft.dueDefaulted ? ` ${phrases.defaultDue}` : '';
  return `${formatInr(draft.amount)} · ${phrases.due} ${formatShortDay(draft.dueDate)}${fallback}`;
}

export function entryCard(input: EntryCardInput): Reply {
  const { draft, language } = input.payload;
  const phrases = phrasesFor(language);
  const isCredit = draft.type === 'credit';
  const after = Math.max(0, input.outstanding + (isCredit ? draft.amount : -draft.amount));
  const text = blocks(
    isCredit ? phrases.addCreditTitle : phrases.paymentTitle,
    [
      shopkeeperLabel(input.shopkeeper),
      amountLine(input),
      ...(draft.note ? [`${phrases.note}: ${draft.note}`] : []),
    ],
    [
      `${phrases.balanceAfter}: ${formatInr(after)}`,
      ...(!isCredit && draft.amount > input.outstanding
        ? [phrases.overpaid(formatInr(input.outstanding))]
        : []),
    ],
  );
  return {
    kind: 'buttons',
    text,
    buttons: [
      { id: cardButtonId(input.actionId, 'save'), title: phrases.save },
      { id: cardButtonId(input.actionId, 'edit'), title: phrases.edit },
      { id: cardButtonId(input.actionId, 'cancel'), title: phrases.cancel },
    ],
  };
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
