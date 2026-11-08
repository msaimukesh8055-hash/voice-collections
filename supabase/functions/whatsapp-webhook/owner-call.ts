// supabase/functions/whatsapp-webhook/owner-call.ts
// "📞 Call Munshi" (M8 A2, Decision 6): the Menu row creates one owner call (issued, 15 minutes)
// and replies with its signed single-use /munshi link. Opening the link uses nothing up; only
// Start call on the page does. A new tap expires any older unused link. Limits: 3 links per 10
// minutes, and no link once today's Munshi sessions are used up (real clock, IST midnight).
// ⚠️ The link message is Saim's approved draft (2026-11-07); the three refusal lines are new
// drafts for Saim. Hindi and Telugu need the native-speaker check.
import type { BotContext } from '../_shared/cards/context.ts';
import { istMidnight } from '../_shared/clock.ts';
import {
  MAX_MUNSHI_SESSIONS_PER_DAY,
  MAX_OWNER_LINKS_PER_WINDOW,
  OWNER_CALL_LINK_TTL_MS,
  OWNER_LINK_WINDOW_MS,
} from '../_shared/calls/owner-call-limits.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import { type Reply, textIn } from '../_shared/whatsapp/replies.ts';

interface OwnerCallPhrases {
  readonly ready: (link: string) => string;
  readonly tooMany: string;
  readonly dailyLimit: string;
  readonly notSetUp: string;
}

const PHRASES: Readonly<Record<Language, OwnerCallPhrases>> = {
  en: {
    ready: (link) =>
      [
        '📞 *Munshi is ready*',
        `Open this in Chrome and tap Start call: ${link}`,
        'The link works once, for 15 minutes.',
      ]
        .join('\n'),
    tooMany: '📞 You asked for a few Munshi links just now. Try again in a few minutes.',
    dailyLimit:
      `📞 Munshi has had today's ${MAX_MUNSHI_SESSIONS_PER_DAY} calls. Try again tomorrow.`,
    notSetUp: '📞 Munshi is not set up yet.',
  },
  hi: {
    ready: (link) =>
      [
        '📞 *मुंशी तैयार है*',
        `इसे Chrome में खोलें और Start call दबाएँ: ${link}`,
        'लिंक एक बार, 15 मिनट तक चलेगा।',
      ]
        .join('\n'),
    tooMany: '📞 अभी कुछ मुंशी लिंक माँगे गए हैं। कुछ मिनट बाद फिर कोशिश करें।',
    dailyLimit: `📞 मुंशी के आज के ${MAX_MUNSHI_SESSIONS_PER_DAY} कॉल हो गए। कल फिर कोशिश करें।`,
    notSetUp: '📞 मुंशी अभी सेट नहीं है।',
  },
  te: {
    ready: (link) =>
      [
        '📞 *మున్షీ రెడీ*',
        `దీన్ని Chrome లో తెరిచి Start call నొక్కండి: ${link}`,
        'లింక్ ఒక్కసారే, 15 నిమిషాలు పనిచేస్తుంది.',
      ]
        .join('\n'),
    tooMany: '📞 ఇప్పుడే కొన్ని మున్షీ లింక్‌లు అడిగారు. కొన్ని నిమిషాల తర్వాత మళ్ళీ ప్రయత్నించండి.',
    dailyLimit: `📞 ఈరోజు మున్షీ ${MAX_MUNSHI_SESSIONS_PER_DAY} కాల్స్ అయిపోయాయి. రేపు మళ్ళీ ప్రయత్నించండి.`,
    notSetUp: '📞 మున్షీ ఇంకా సెట్ కాలేదు.',
  },
};

export function ownerCallPhrasesFor(language: Language): OwnerCallPhrases {
  return PHRASES[language];
}

type Refusal = 'tooMany' | 'dailyLimit';

function refusalReply(refusal: Refusal | 'notSetUp', language: Language): Reply {
  return textIn(language, (each) => ownerCallPhrasesFor(each)[refusal]);
}

/** The first limit already reached, or null. Both counts in one round trip. */
async function limitReached(ctx: BotContext): Promise<Refusal | null> {
  const { ownerCalls } = ctx.munshi;
  const [sessionsToday, recentLinks] = await Promise.all([
    ownerCalls.countOwnerUrlsIssuedSince(istMidnight(ctx.now)),
    ownerCalls.countOwnerCallsIssuedSince(
      ctx.owner.id,
      new Date(ctx.now.getTime() - OWNER_LINK_WINDOW_MS),
    ),
  ]);
  if (sessionsToday >= MAX_MUNSHI_SESSIONS_PER_DAY) return 'dailyLimit';
  return recentLinks >= MAX_OWNER_LINKS_PER_WINDOW ? 'tooMany' : null;
}

/** The Menu's "📞 Call Munshi" row: one fresh link, older unused ones expired. */
export async function startOwnerCall(ctx: BotContext): Promise<readonly Reply[]> {
  const { link } = ctx.munshi;
  if (link === null) return [refusalReply('notSetUp', ctx.language)];
  const refusal = await limitReached(ctx);
  if (refusal) return [refusalReply(refusal, ctx.language)];
  await ctx.munshi.ownerCalls.expireIssuedOwnerCalls(ctx.owner.id);
  const call = await ctx.munshi.ownerCalls.createOwnerCall({
    ownerId: ctx.owner.id,
    expiresAt: new Date(ctx.now.getTime() + OWNER_CALL_LINK_TTL_MS).toISOString(),
  });
  const url = await link(call.id);
  ctx.log('info', 'owner_call_issued', { ownerCallId: call.id });
  return [textIn(ctx.language, (each) => ownerCallPhrasesFor(each).ready(url))];
}
