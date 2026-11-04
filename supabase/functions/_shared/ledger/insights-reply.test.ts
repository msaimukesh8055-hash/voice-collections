// supabase/functions/_shared/ledger/insights-reply.test.ts
// The "insights" WhatsApp reply (M6, SPEC §6.6): chart + caption, text, and the no-chart case.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { LATHA, RAMESH } from '../db/fake-book-repository.ts';
import { replyText } from '../whatsapp/replies.ts';
import type { Insights } from './insights.ts';
import { insightsPhrasesFor, monthName } from './insights-phrases.ts';
import { dashboardReply, insightsReplies } from './insights-reply.ts';
import type { ScoreTag } from './views.ts';

const INSIGHTS: Insights = {
  today: '2026-11-18',
  split: { month: '2026-11', collected: 3000, notYetDue: 0, overdue: 7000, total: 10000 },
  percentCollected: 30,
  weekChange: 6,
  outstanding: 184000,
  top: [
    { shopkeeper: RAMESH, overdueAmount: 5000, daysOverdue: 12 },
    { shopkeeper: LATHA, overdueAmount: 2000, daysOverdue: 8 },
  ],
};
const SCORES = new Map<string, ScoreTag>([
  [RAMESH.id, { score: 42, band: 'risky' }],
  [LATHA.id, { score: 90, band: 'new' }],
]);
const LINK = 'https://dash.example/#t=T';

Deno.test('insights reply › chart with caption, then the text with top 5 and link', () => {
  const replies = insightsReplies({
    insights: INSIGHTS,
    scores: SCORES,
    language: 'en',
    chartId: 'IMG1',
    dashboardLink: LINK,
  });
  assertEquals(replies[0], {
    kind: 'image',
    mediaId: 'IMG1',
    text: '📊 *30% collected this month*\n\n🟩 Collected ₹3,000\n🟧 Overdue ₹7,000',
  });
  assertEquals(
    replies[1],
    {
      kind: 'text',
      text: '📊 *Insights · November*\n\n' +
        'Collected this month: *30%* (▲ 6 points vs last week)\nTotal outstanding: *₹1,84,000*\n\n' +
        '*Top 5 overdue*\n' +
        '1. Ramesh (Ramesh Kirana) · ₹5,000 · 12 days overdue · Risky 42\n' +
        '2. Latha (Latha General Stores) · ₹2,000 · 8 days overdue · New\n\n' +
        `Full detail: ${LINK}`,
    },
  );
});

Deno.test('insights reply › no chart → the slices go in the text; no link → no link line', () => {
  const replies = insightsReplies({
    insights: { ...INSIGHTS, weekChange: null, top: [] },
    scores: new Map(),
    language: 'en',
    chartId: null,
    dashboardLink: null,
  });
  assertEquals(replies.length, 1);
  const text = replyText(replies);
  assertStringIncludes(text, '🟩 Collected ₹3,000\n🟧 Overdue ₹7,000');
  assertStringIncludes(text, 'Nobody is overdue. 🎉');
  assert(!text.includes('vs last week') && !text.includes('Full detail'));
});

Deno.test('insights reply › nothing due this month; a score missing → no band', () => {
  const empty: Insights = {
    ...INSIGHTS,
    split: { month: '2026-11', collected: 0, notYetDue: 0, overdue: 0, total: 0 },
    percentCollected: null,
    weekChange: null,
  };
  const text = replyText(
    insightsReplies({
      insights: empty,
      scores: new Map(),
      language: 'en',
      chartId: null,
      dashboardLink: null,
    }),
  );
  assertStringIncludes(text, 'No credit falls due this month yet.');
  assertStringIncludes(text, '1. Ramesh (Ramesh Kirana) · ₹5,000 · 12 days overdue\n');
  assertEquals(insightsPhrasesFor('en').captionTitle(null), '📊 No credit falls due this month');
});

Deno.test('insights reply › week change wording: up, down, same, in every language', () => {
  const en = insightsPhrasesFor('en');
  assertEquals([en.change(6), en.change(-3), en.change(0)], [
    '(▲ 6 points vs last week)',
    '(▼ 3 points vs last week)',
    '(same as last week)',
  ]);
  for (const language of ['hi', 'te'] as const) {
    const phrases = insightsPhrasesFor(language);
    assertStringIncludes(phrases.change(6), '▲ 6');
    assertStringIncludes(phrases.change(-3), '▼ 3');
    assert(!/[▲▼]/.test(phrases.change(0)));
  }
});

Deno.test('insights reply › Telugu and Hindi keep figures and names; month names localised', () => {
  for (const language of ['hi', 'te'] as const) {
    const text = replyText(
      insightsReplies({
        insights: INSIGHTS,
        scores: SCORES,
        language,
        chartId: 'I',
        dashboardLink: LINK,
      }),
    );
    for (const figure of ['30%', '₹3,000', '₹1,84,000', 'Ramesh', '12', LINK]) {
      assertStringIncludes(text, figure);
    }
  }
  assertEquals(monthName('2026-11', 'en'), 'November');
  assert(monthName('2026-11', 'te') !== 'November');
});

Deno.test('insights reply › the dashboard command: link, or "not set up"', () => {
  assertStringIncludes(replyText([dashboardReply(LINK, 'en')]), `24 hours):\n${LINK}`);
  assertEquals(replyText([dashboardReply(null, 'en')]), 'The dashboard is not set up yet.');
  assertStringIncludes(replyText([dashboardReply(null, 'te')]), 'డ్యాష్‌బోర్డ్');
});

Deno.test('insights reply › every language has both caption titles and the empty lines', () => {
  for (const language of ['en', 'hi', 'te'] as const) {
    const phrases = insightsPhrasesFor(language);
    assertStringIncludes(phrases.captionTitle(30), '30%');
    assert(!phrases.captionTitle(null).includes('%'));
    for (const line of [phrases.nothingThisMonth, phrases.noneOverdue, phrases.noDashboard]) {
      assert(line.length > 5, `${language}: ${line}`);
    }
  }
});
