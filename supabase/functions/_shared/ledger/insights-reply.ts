// supabase/functions/_shared/ledger/insights-reply.ts
// The "insights" reply on WhatsApp (SPEC §6.6): (1) the ring chart as an image, its caption
// carrying the % and the three slices next to matching colour squares; (2) a text with % collected
// and the change vs last week, total outstanding, the top 5 overdue with their score, and the
// dashboard link. Without a chart (nothing due this month, or the upload failed) the slices go
// into the text instead. Pure: the caller works out the figures, uploads the PNG and makes the link.
import { SLICE_COLOURS } from '../charts/pie.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { formatInr } from '../format.ts';
import { summaryPhrasesFor } from '../followup/summary-phrases.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { blocks, type Reply, textIn, textReply, withEnglish } from '../whatsapp/replies.ts';
import type { Insights } from './insights.ts';
import { type InsightsPhrases, insightsPhrasesFor, monthName } from './insights-phrases.ts';
import type { ScoreTag } from './views.ts';

export interface InsightsView {
  readonly insights: Insights;
  readonly scores: ReadonlyMap<string, ScoreTag>;
  readonly language: Language;
  /** Meta media id of the uploaded chart, or null (no chart). */
  readonly chartId: string | null;
  readonly dashboardLink: string | null;
}

function label(shopkeeper: BookShopkeeper): string {
  return shopkeeper.name === shopkeeper.shopName
    ? shopkeeper.name
    : `${shopkeeper.name} (${shopkeeper.shopName})`;
}

/** 🟩 Collected ₹3,000 · 🟦 Not yet due ₹4,000 · 🟧 Overdue ₹3,000 (zero slices left out). */
function sliceLines(view: InsightsView, phrases: InsightsPhrases): string[] {
  const { split } = view.insights;
  const slices = [
    { square: SLICE_COLOURS.collected.square, name: phrases.collected, amount: split.collected },
    { square: SLICE_COLOURS.notYetDue.square, name: phrases.notYetDue, amount: split.notYetDue },
    { square: SLICE_COLOURS.overdue.square, name: phrases.overdue, amount: split.overdue },
  ];
  return slices
    .filter((slice) => slice.amount > 0)
    .map((slice) => `${slice.square} ${slice.name} ${formatInr(slice.amount)}`);
}

function bandOf(tag: ScoreTag | undefined, language: Language): string {
  if (!tag) return '';
  const band = summaryPhrasesFor(language).bands[tag.band];
  return tag.band === 'new' ? ` · ${band}` : ` · ${band} ${tag.score}`;
}

function topLines(view: InsightsView, phrases: InsightsPhrases): string[] {
  if (view.insights.top.length === 0) return [phrases.noneOverdue];
  return [
    phrases.topTitle,
    ...view.insights.top.map((row, index) =>
      `${index + 1}. ${label(row.shopkeeper)} · ${formatInr(row.overdueAmount)} · ${
        phrases.daysOverdue(row.daysOverdue)
      }${bandOf(view.scores.get(row.shopkeeper.id), view.language)}`
    ),
  ];
}

function collectedLine(view: InsightsView, phrases: InsightsPhrases): string {
  const { percentCollected, weekChange } = view.insights;
  if (percentCollected === null) return phrases.nothingThisMonth;
  const change = weekChange === null ? '' : ` ${phrases.change(weekChange)}`;
  return `${phrases.collectedLine(percentCollected)}${change}`;
}

/** The chart and the text, each with its English rendering for the twin (dry-run fix 4). */
export function insightsReplies(view: InsightsView): readonly Reply[] {
  const replies = insightsIn(view);
  if (view.language === 'en') return replies;
  const english = insightsIn({ ...view, language: 'en' });
  return replies.map((reply, index) =>
    withEnglish(view.language, (language) => language === 'en' ? english[index] ?? reply : reply)
  );
}

function insightsIn(view: InsightsView): readonly Reply[] {
  const phrases = insightsPhrasesFor(view.language);
  const { insights } = view;
  const slices = sliceLines(view, phrases);
  const text = blocks(
    phrases.title(monthName(insights.split.month, view.language)),
    [
      collectedLine(view, phrases),
      phrases.outstanding(formatInr(insights.outstanding)),
    ],
    view.chartId ? null : slices,
    topLines(view, phrases),
    view.dashboardLink ? phrases.fullDetail(view.dashboardLink) : null,
  );
  if (!view.chartId) return [textReply(text)];
  const caption = blocks(phrases.captionTitle(insights.percentCollected), slices);
  return [{ kind: 'image', mediaId: view.chartId, text: caption }, textReply(text)];
}

/** The "dashboard" command's reply. */
export function dashboardReply(link: string | null, language: Language): Reply {
  return textIn(language, function dashboardLine(each): string {
    const phrases = insightsPhrasesFor(each);
    return link ? phrases.dashboardLink(link) : phrases.noDashboard;
  });
}
