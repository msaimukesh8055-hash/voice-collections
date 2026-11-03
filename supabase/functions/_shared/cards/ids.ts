// supabase/functions/_shared/cards/ids.ts
// What a tapped button or list row stands for. Ids carry a database id, never an amount or a
// name, so a tap can only act on a card or claim that exists and is still open:
//   c:<card id>:<save|edit|cancel|yes|no|p0…p9>   card actions (pending_actions row)
//   cl:<entry id>:<ok|no>:<lang>                  confirm / reject a payment claim
//   lk:<shopkeeper id>:<lang>                     show one shopkeeper (read only)
import type { Language } from '../schemas/shopkeeper.ts';
import { LanguageSchema } from '../schemas/shopkeeper.ts';

export const CARD_VERBS = ['save', 'edit', 'cancel', 'yes', 'no'] as const;
export type CardVerb = (typeof CARD_VERBS)[number];

export type Tap =
  | { readonly kind: 'card'; readonly actionId: string; readonly verb: CardVerb }
  | { readonly kind: 'pick'; readonly actionId: string; readonly index: number }
  | {
    readonly kind: 'claim';
    readonly entryId: string;
    readonly confirm: boolean;
    readonly language: Language;
  }
  | { readonly kind: 'lookup'; readonly shopkeeperId: string; readonly language: Language };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CARD = new RegExp(`^c:(${UUID}):(save|edit|cancel|yes|no|p\\d)$`);
const CLAIM = new RegExp(`^cl:(${UUID}):(ok|no):([a-z]{2})$`);
const LOOKUP = new RegExp(`^lk:(${UUID}):([a-z]{2})$`);
const PICK_PREFIX = 'p';

export function cardButtonId(actionId: string, verb: CardVerb): string {
  return `c:${actionId}:${verb}`;
}

export function pickRowId(actionId: string, index: number): string {
  return `c:${actionId}:${PICK_PREFIX}${index}`;
}

export function claimButtonId(entryId: string, confirm: boolean, language: Language): string {
  return `cl:${entryId}:${confirm ? 'ok' : 'no'}:${language}`;
}

export function lookupRowId(shopkeeperId: string, language: Language): string {
  return `lk:${shopkeeperId}:${language}`;
}

function cardTap(actionId: string, verb: string): Tap {
  if (verb.startsWith(PICK_PREFIX)) {
    return { kind: 'pick', actionId, index: Number(verb.slice(PICK_PREFIX.length)) };
  }
  return { kind: 'card', actionId, verb: verb as CardVerb };
}

/** The tap, or null for an id we never sent (or a language we do not support). */
export function parseTap(buttonId: string): Tap | null {
  const card = CARD.exec(buttonId);
  if (card?.[1] && card[2]) return cardTap(card[1], card[2]);
  const claim = CLAIM.exec(buttonId);
  const claimLanguage = LanguageSchema.safeParse(claim?.[3]);
  if (claim?.[1] && claimLanguage.success) {
    return {
      kind: 'claim',
      entryId: claim[1],
      confirm: claim[2] === 'ok',
      language: claimLanguage.data,
    };
  }
  const lookup = LOOKUP.exec(buttonId);
  const lookupLanguage = LanguageSchema.safeParse(lookup?.[2]);
  if (lookup?.[1] && lookupLanguage.success) {
    return { kind: 'lookup', shopkeeperId: lookup[1], language: lookupLanguage.data };
  }
  return null;
}
