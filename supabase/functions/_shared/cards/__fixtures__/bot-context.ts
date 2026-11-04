// supabase/functions/_shared/cards/__fixtures__/bot-context.ts
// A BotContext over the fake book (FAKE data), for card, claim and router tests.
import {
  createFakeBookRepository,
  FAKE_OWNER,
  FAKE_TODAY,
  type FakeBookState,
} from '../../db/fake-book-repository.ts';
import type { BookRepository } from '../../db/book-repository.ts';
import type { LogFields, Logger } from '../../log.ts';
import type { Language } from '../../schemas/shopkeeper.ts';
import { type ReminderSetup, reminderSetup } from '../../reminders/__fixtures__/reminder-deps.ts';
import type { BotContext, WebDeps } from '../context.ts';

/** Noon IST on FAKE_TODAY (real time, used for card expiry). */
export const FAKE_NOW = new Date('2026-11-02T12:00:00+05:30');
export const FAKE_NEW_PHONE = '+91 00000 91234';

export interface BotSetup {
  readonly ctx: BotContext;
  readonly state: FakeBookState;
  readonly logs: Array<{ event: string; fields: LogFields }>;
  /** The fakes behind ctx.reminder (M5). */
  readonly reminder: ReminderSetup;
}

export interface BotSetupOptions {
  readonly state?: Partial<FakeBookState>;
  readonly book?: Partial<BookRepository>;
  readonly language?: Language;
  readonly now?: Date;
  readonly reminder?: ReminderSetup;
  readonly web?: WebDeps;
}

export const FAKE_DASHBOARD_LINK = 'https://dashboard.example/#t=TOKEN';
export const FAKE_PHONE_LINK = 'https://dashboard.example/phone';

/** The fake customer-page link for one shopkeeper. */
export function fakeShopkeeperLink(shopkeeperId: string): string {
  return `https://dashboard.example/shopkeepers?id=${shopkeeperId}#t=TOKEN`;
}

/** Upload always works; the dashboard, customer and phone links are fixed fakes. */
export const FAKE_WEB: WebDeps = {
  uploadImage: () => Promise.resolve('IMG1'),
  dashboardLink: () => Promise.resolve(FAKE_DASHBOARD_LINK),
  shopkeeperLink: (shopkeeperId) => Promise.resolve(fakeShopkeeperLink(shopkeeperId)),
  phonePageLink: FAKE_PHONE_LINK,
};

/** No dashboard set up (DASHBOARD_URL or DASHBOARD_LINK_SECRET missing): no links at all. */
export const NO_LINKS_WEB: WebDeps = {
  uploadImage: () => Promise.resolve('IMG1'),
  dashboardLink: () => Promise.resolve(null),
  shopkeeperLink: () => Promise.resolve(null),
  phonePageLink: null,
};

export function botSetup(options: BotSetupOptions = {}): BotSetup {
  const fake = createFakeBookRepository(options.state);
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const log: Logger = (_level, event, fields = {}) => logs.push({ event, fields });
  const reminder = options.reminder ?? reminderSetup({ now: options.now ?? FAKE_NOW });
  const ctx: BotContext = {
    book: { ...fake.book, ...options.book },
    owner: FAKE_OWNER,
    shopkeepers: fake.state.shopkeepers,
    today: FAKE_TODAY,
    now: options.now ?? FAKE_NOW,
    language: options.language ?? 'en',
    newPhone: () => FAKE_NEW_PHONE,
    log,
    reminder: reminder.deps,
    web: options.web ?? FAKE_WEB,
  };
  return { ctx, state: fake.state, logs, reminder };
}

/** Same context, with the shopkeeper list re-read (after a new shopkeeper was added). */
export function refreshed(setup: BotSetup, overrides: Partial<BotContext> = {}): BotContext {
  return { ...setup.ctx, shopkeepers: setup.state.shopkeepers, ...overrides };
}
