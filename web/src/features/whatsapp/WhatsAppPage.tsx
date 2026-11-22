// web/src/features/whatsapp/WhatsAppPage.tsx
// WhatsApp live checks (Saim, 2026-11-22; ADR-0022): /whatsapp lists the owner's latest WhatsApp
// messages to the bot, each with its verdict; /whatsapp?id=… is one message's report, laid out like
// a call page: facts, what he sent and what the bot replied, the scorecard, "Add as a test case".
// The text is kept for 30 days. Agent health's WhatsApp card links here, filtered.
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { ExchangeDetail, ExchangeListItem } from '../../lib/whatsappSchemas.ts';
import { type CallFilter, FilteredCard, onlyFiltered } from '../calls/callFilter.tsx';
import { Scorecard } from '../calls/Scorecard.tsx';
import { dateTime } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { AddTestCase } from '../evals/AddTestCase.tsx';
import { type Tone, TONE_CLASSES } from '../ops/opsFormat.ts';

export const WHATSAPP_PATH = '/whatsapp';
const SHORT_TEXT = 60;

const TYPES: Readonly<Record<string, string>> = {
  text: '💬 Typed',
  voice: '🎤 Voice note',
  tap: '👆 Button',
  other: '📎 Other',
};

const UNDERSTOOD_BY: Readonly<Record<string, string>> = {
  command: 'fixed rules (code)',
  button: 'button (code)',
  sarvam: 'Sarvam AI',
  gemini: 'Gemini (backup AI)',
  failed: 'not understood',
  stranger: 'stranger',
};

const VERDICTS: Readonly<
  Record<ExchangeListItem['verdict'], { readonly label: string; readonly tone: Tone }>
> = {
  good: { label: '✅ Went well', tone: 'good' },
  check: { label: '⚠ Needs a look', tone: 'warn' },
  failed: { label: '❌ Failed', tone: 'bad' },
};

/** Short "why" next to the result in the list, one per check id. */
const REASONS: Readonly<Record<string, string>> = {
  wa_money_on_tap: 'money moved without a tap',
  wa_no_card_when_lost: 'money card from a misread',
  wa_understood: 'not understood',
  wa_card_answered: 'card not answered',
  wa_voice_reply: 'no voice reply',
  wa_delivered: 'reply not delivered',
  wa_reply_time: 'slow reply',
  wa_cost: 'cost over aim',
};

function reasonText(row: ExchangeListItem): string {
  return row.reasons
    .map((id) => {
      const text = REASONS[id] ?? id;
      return id === 'wa_reply_time' ? `${text} (${seconds(row.handleMs)})` : text;
    })
    .join(', ');
}

const SCORE_NOTE = 'worked out in code from what was kept for this message, no AI';

function typeOf(msgType: string): string {
  return TYPES[msgType] ?? msgType;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function shortText(text: string | null): string {
  if (!text) return '—';
  return text.length > SHORT_TEXT ? `${text.slice(0, SHORT_TEXT - 1)}…` : text;
}

function TestTag(): React.JSX.Element {
  return (
    <span
      className="ml-2 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink-muted"
      title="Sent by the free smoke test, not by the owner. Left out of Agent health."
    >
      Test
    </span>
  );
}

function Facts({ exchange }: { readonly exchange: ExchangeDetail['exchange'] }): React.JSX.Element {
  const facts = [
    ['When', dateTime(exchange.createdAt)],
    ['Type', typeOf(exchange.msgType)],
    ['Understood by', UNDERSTOOD_BY[exchange.path] ?? exchange.path],
    ['Asked for', exchange.command ?? '—'],
    ['Reply time', seconds(exchange.handleMs)],
  ] as const;
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Owner message{exchange.isTest ? <TestTag /> : null}
      </p>
      <h1 className="text-2xl font-semibold">WhatsApp message to the bot</h1>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Bubble({
  who,
  text,
  mine,
}: {
  readonly who: string;
  readonly text: string | null;
  readonly mine: boolean;
}): React.JSX.Element {
  const side = mine ? 'self-end bg-brand-soft' : 'self-start bg-canvas';
  return (
    <div className={`max-w-[90%] rounded-xl p-3 ring-1 ring-border ${side}`}>
      <p className="text-xs font-medium text-ink-muted">{who}</p>
      <p className="whitespace-pre-wrap text-sm">{text ?? '(nothing kept)'}</p>
    </div>
  );
}

function Conversation({
  exchange,
}: {
  readonly exchange: ExchangeDetail['exchange'];
}): React.JSX.Element {
  const heard = exchange.msgType === 'voice' ? 'You (what the bot heard)' : 'You';
  const bot = exchange.voiceReply ? 'Bot (text, then a voice reply)' : 'Bot';
  return (
    <Card title="The message">
      <div className="flex flex-col gap-3">
        <Bubble who={heard} text={exchange.inText} mine />
        <Bubble who={bot} text={exchange.replyText} mine={false} />
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        Kept for 30 days, then deleted. Phone numbers are never kept.
      </p>
    </Card>
  );
}

export function ExchangeReport({
  detail,
  action,
}: {
  readonly detail: ExchangeDetail;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <a href={WHATSAPP_PATH} className="text-sm font-medium text-brand underline">
        ← All WhatsApp messages
      </a>
      <Facts exchange={detail.exchange} />
      <Conversation exchange={detail.exchange} />
      <Scorecard card={detail.scorecard} noun="Message" note={SCORE_NOTE} />
      {action}
    </>
  );
}

function One({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.exchange(id), `exchange:${id}`);
  return (
    <LoadState state={state}>
      {(detail: ExchangeDetail) => (
        <ExchangeReport
          detail={detail}
          action={
            <AddTestCase
              dashboard={dashboard}
              source="whatsapp_chat"
              refId={detail.exchange.id}
              initialSaid={detail.exchange.inText ?? ''}
            />
          }
        />
      )}
    </LoadState>
  );
}

function ExchangeList({
  exchanges,
}: {
  readonly exchanges: readonly ExchangeListItem[];
}): React.JSX.Element {
  if (exchanges.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No WhatsApp messages kept yet. Messages are kept from 22 Nov 2026, for 30 days.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-ink-muted">
        <tr>
          <th className="pb-1 pr-3 font-medium">When</th>
          <th className="pb-1 pr-3 font-medium">Type</th>
          <th className="pb-1 pr-3 font-medium">You sent</th>
          <th className="pb-1 pr-3 font-medium">Reply time</th>
          <th className="pb-1 font-medium">Result</th>
        </tr>
      </thead>
      <tbody>
        {exchanges.map((row) => (
          <tr key={row.id} className="border-t border-border align-top">
            <td className="py-2 pr-3">
              <a
                href={`${WHATSAPP_PATH}?id=${encodeURIComponent(row.id)}`}
                className="font-medium text-brand underline"
              >
                {dateTime(row.createdAt)}
              </a>
              {row.isTest ? <TestTag /> : null}
            </td>
            <td className="py-2 pr-3 whitespace-nowrap">{typeOf(row.msgType)}</td>
            <td className="py-2 pr-3">{shortText(row.inText)}</td>
            <td className="py-2 pr-3">{seconds(row.handleMs)}</td>
            <td className={`py-2 font-medium ${TONE_CLASSES[VERDICTS[row.verdict].tone]}`}>
              {VERDICTS[row.verdict].label}
              {row.reasons.length > 0 ? (
                <span className="block text-xs font-normal">{reasonText(row)}</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function All({
  dashboard,
  filter,
}: {
  readonly dashboard: DashboardApi;
  readonly filter: CallFilter | null;
}): React.JSX.Element {
  const state = useLoad(dashboard.exchanges, 'exchanges');
  return (
    <LoadState state={state}>
      {(exchanges: readonly ExchangeListItem[]) => {
        const shown = onlyFiltered(exchanges, filter);
        return (
          <FilteredCard
            title="WhatsApp chats"
            page={WHATSAPP_PATH}
            filter={filter}
            shown={shown.length}
            many="messages"
          >
            <ExchangeList exchanges={shown} />
          </FilteredCard>
        );
      }}
    </LoadState>
  );
}

export function WhatsAppPage({
  dashboard,
  id,
  filter = null,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
  /** From Agent health: show only these messages (callFilter.tsx). */
  readonly filter?: CallFilter | null;
}): React.JSX.Element {
  return (
    <Layout current={WHATSAPP_PATH} dashboard={dashboard}>
      {id ? <One dashboard={dashboard} id={id} /> : <All dashboard={dashboard} filter={filter} />}
    </Layout>
  );
}
