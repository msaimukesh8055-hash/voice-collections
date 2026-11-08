// supabase/functions/_shared/cards/context.ts
// Everything one owner message needs, loaded once per message by the webhook.
import type { BookRepository, BookShopkeeper, Owner } from '../db/book-repository.ts';
import type { OwnerCallRepository } from '../db/owner-call-repository.ts';
import type { Logger } from '../log.ts';
import type { ReminderDeps } from '../reminders/deps.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export interface BotContext {
  readonly book: BookRepository;
  readonly owner: Owner;
  readonly shopkeepers: readonly BookShopkeeper[];
  /** India date on the demo clock: entry dates, due dates, overdue days. */
  readonly today: string;
  /** Real time: card expiry (30 minutes of the owner's actual time). */
  readonly now: Date;
  /** Reply language of the current message (taps use the language saved on the card). */
  readonly language: Language;
  /** A fake phone number for a shopkeeper added from WhatsApp (never-real range). */
  readonly newPhone: () => string;
  readonly log: Logger;
  /** Due alert, Remind, remind all and score explain (M5 5b). */
  readonly reminder: ReminderDeps;
  /** Insights chart and dashboard link (M6). */
  readonly web: WebDeps;
  /** "📞 Call Munshi" (M8): the owner call rows and the signed /munshi link. */
  readonly munshi: MunshiLinkDeps;
}

export interface MunshiLinkDeps {
  readonly ownerCalls: Pick<
    OwnerCallRepository,
    | 'createOwnerCall'
    | 'expireIssuedOwnerCalls'
    | 'countOwnerCallsIssuedSince'
    | 'countOwnerUrlsIssuedSince'
  >;
  /** The signed /munshi link for one owner call, or null when Munshi is not set up (no web
   * address or no MUNSHI_LINK_SECRET). */
  readonly link: ((ownerCallId: string) => Promise<string>) | null;
}

export interface WebDeps {
  /** Uploads a PNG to Meta for one message: its media id, or null (already logged). */
  readonly uploadImage: (png: Uint8Array<ArrayBuffer>) => Promise<string | null>;
  /** A signed dashboard link for the owner (24 hours), or null when no dashboard is set up. */
  readonly dashboardLink: () => Promise<string | null>;
  /** Reply links (cloud build): one customer's page in the books (signed, 24 hours), or null
   * when no dashboard is set up. */
  readonly shopkeeperLink: (shopkeeperId: string) => Promise<string | null>;
  /** Reply links (cloud build): the public phone page, or null when no dashboard is set up. */
  readonly phonePageLink: string | null;
}

/** The "View in books" link for a reply, or null. Never fails: a reply goes out without the
 * line rather than not at all (the Save has already happened by then). */
export async function booksLinkFor(ctx: BotContext, shopkeeperId: string): Promise<string | null> {
  try {
    return await ctx.web.shopkeeperLink(shopkeeperId);
  } catch (error) {
    ctx.log('warn', 'books_link_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

/** New shopkeepers get +91 00000 9xxxx: the seed uses 00001–00100, and no real phone starts
 * with 00000, so these can never reach a real person. */
export const NEW_PHONE_PREFIX = '+91 00000 9';
const NEW_PHONE_DIGITS = 4;

export function randomFakePhone(random: () => number = Math.random): string {
  const digits = Math.floor(random() * 10 ** NEW_PHONE_DIGITS);
  return `${NEW_PHONE_PREFIX}${String(digits).padStart(NEW_PHONE_DIGITS, '0')}`;
}

export function findShopkeeper(ctx: BotContext, shopkeeperId: string): BookShopkeeper | null {
  return ctx.shopkeepers.find((shopkeeper) => shopkeeper.id === shopkeeperId) ?? null;
}
