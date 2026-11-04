// supabase/functions/_shared/reminders/alert-replies.ts
// How the due alert looks on the owner's phone (SPEC §6.4):
//   1. the alert text: broke a promise / overdue / due today, up to 10 lines a section
//   2. a Remind action per person: reply buttons for up to 3 people, a list of up to 10 for more
//   3. [Remind all due] when 2 or more people are due
// Outside WhatsApp's 24-hour window only an approved template may be sent (M5 Decision 7): a
// short "N shopkeepers are due today. Reply DUE to see them." His reply opens the window.
import { remindAllButtonId, remindButtonId } from '../cards/ids.ts';
import { formatInr, formatShortDay } from '../format.ts';
import type { DueAlert, DuePerson } from '../ledger/due-alert.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { MAX_BUTTONS, MAX_LIST_ROWS, type Reply, textReply } from '../whatsapp/replies.ts';
import { type ReminderPhrases, reminderPhrasesFor } from './phrases.ts';

export const SECTION_ROWS = 10;

/** The utility template Saim approves in Meta (Decision 7). Body, with {{1}} = people due:
 * "Good morning. {{1}} shopkeepers are due today. Reply DUE to see them." */
export const DAILY_ALERT_TEMPLATE = {
  name: 'daily_due_alert',
  languageCode: 'en',
} as const;

export function templateText(count: number): string {
  return `Good morning. ${count} shopkeepers are due today. Reply DUE to see them.`;
}

export function dailyAlertTemplate(count: number): Reply {
  return {
    kind: 'template',
    name: DAILY_ALERT_TEMPLATE.name,
    languageCode: DAILY_ALERT_TEMPLATE.languageCode,
    bodyParams: [String(count)],
    text: templateText(count),
  };
}

function label(person: DuePerson): string {
  const { name, shopName } = person.shopkeeper;
  return name === shopName ? name : `${name} (${shopName})`;
}

function lineOf(person: DuePerson, phrases: ReminderPhrases): string {
  const { dues, brokenPromise } = person;
  if (brokenPromise) {
    return phrases.brokenLine({
      label: label(person),
      promised: formatInr(brokenPromise.amount),
      day: formatShortDay(brokenPromise.promiseDate),
      owed: formatInr(dues.outstanding),
    });
  }
  if (person.reason === 'overdue') {
    return phrases.overdueLine(label(person), formatInr(dues.overdueAmount), dues.daysOverdue);
  }
  return phrases.dueTodayLine(label(person), formatInr(dues.nextDueAmount));
}

function section(
  title: string,
  people: readonly DuePerson[],
  language: Language,
): readonly string[] {
  if (people.length === 0) return [];
  const phrases = reminderPhrasesFor(language);
  const lines = people.slice(0, SECTION_ROWS).map((person) => lineOf(person, phrases));
  const more = people.length > SECTION_ROWS
    ? [phrasesFor(language).andMore(people.length - SECTION_ROWS)]
    : [];
  return ['', title, ...lines, ...more];
}

function alertText(alert: DueAlert, today: string, language: Language): string {
  const phrases = reminderPhrasesFor(language);
  return [
    phrases.alertTitle(formatShortDay(today)),
    ...section(phrases.sectionBroken(alert.brokenPromise.length), alert.brokenPromise, language),
    ...section(phrases.sectionOverdue(alert.overdue.length), alert.overdue, language),
    ...section(phrases.sectionDueToday(alert.dueToday.length), alert.dueToday, language),
  ].join('\n');
}

function rowDescription(person: DuePerson, phrases: ReminderPhrases): string {
  const { dues } = person;
  if (person.reason === 'broken_promise') return phrases.rowBroken(formatInr(dues.outstanding));
  if (person.reason === 'overdue') {
    return phrases.rowOverdue(formatInr(dues.overdueAmount), dues.daysOverdue);
  }
  return phrases.rowDueToday(formatInr(dues.nextDueAmount));
}

/** Buttons for up to 3 people, else a list of the first 10. Nobody is called from here. */
function picker(people: readonly DuePerson[], language: Language): Reply {
  const phrases = reminderPhrasesFor(language);
  if (people.length <= MAX_BUTTONS) {
    const buttons = people.map((person) => ({
      id: remindButtonId(person.shopkeeper.id, language),
      title: phrases.remindButton(person.shopkeeper.name),
    }));
    return { kind: 'buttons', text: phrases.pickerText, buttons };
  }
  const rows = people.slice(0, MAX_LIST_ROWS).map((person) => ({
    id: remindButtonId(person.shopkeeper.id, language),
    title: person.shopkeeper.name,
    description: rowDescription(person, phrases),
  }));
  return { kind: 'list', text: phrases.pickerText, buttonLabel: phrases.listButton, rows };
}

function remindAllOffer(count: number, language: Language): Reply {
  const phrases = reminderPhrasesFor(language);
  return {
    kind: 'buttons',
    text: phrases.remindAllText(count),
    buttons: [{ id: remindAllButtonId(language), title: phrases.remindAllButton }],
  };
}

export function dueAlertReplies(alert: DueAlert, today: string, language: Language): Reply[] {
  if (alert.people.length === 0) return [textReply(reminderPhrasesFor(language).nobodyDue)];
  const replies = [textReply(alertText(alert, today, language)), picker(alert.people, language)];
  return alert.people.length > 1
    ? [...replies, remindAllOffer(alert.people.length, language)]
    : replies;
}
