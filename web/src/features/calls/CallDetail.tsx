// web/src/features/calls/CallDetail.tsx
// One call (SPEC §12 /calls): who, live or simulated, tone level, length and cost; the
// follow-up agent's decision (rule or agent, and why); the WhatsApp summary; the transcript; and
// every tool Asha called with what it sent and got back (the call token is removed server-side).
// Telugu and Hindi lines show their English (Sarvam Translate) underneath, in small grey text.
import type { CallDetail as Detail } from '../../lib/dashboardApi.ts';
import { dateTime, duration, formatInr } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';

const LANGUAGE_NAMES = { te: 'Telugu', hi: 'Hindi', en: 'English' } as const;

/** The WhatsApp summary as plain text: WhatsApp's *bold* stars are dropped on the web. */
export function plainSummary(summary: string): string {
  return summary.replace(/\*/g, '');
}

function Facts({ call }: { readonly call: Detail }): React.JSX.Element {
  const cost = `${call.cost.estimate ? '≈ ' : ''}${formatInr(call.cost.inr)}`;
  const facts = [
    ['When', dateTime(call.queuedAt)],
    ['Type', call.mode],
    ['Status', call.status.replace('_', ' ')],
    ['Tone level', String(call.toneLevel)],
    ['Language', LANGUAGE_NAMES[call.language]],
    ['Length', duration(call.durationSeconds)],
    ['Cost', cost],
  ] as const;
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{call.shopName}</p>
      <h1 className="text-2xl font-semibold">Call with {call.shopkeeperName}</h1>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
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

function FollowUp({ call }: { readonly call: Detail }): React.JSX.Element {
  return (
    <Card title="After the call">
      {call.followup ? (
        <p className="text-sm">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
            {call.followup.path === 'rule' ? 'rule' : 'agent'}
          </span>{' '}
          <span className="font-medium">{call.followup.decision.replace(/_/g, ' ')}</span> —{' '}
          {call.followup.reasoning}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">No follow-up yet.</p>
      )}
      {call.summary ? (
        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas p-3 font-sans text-sm">
          {plainSummary(call.summary)}
        </pre>
      ) : null}
    </Card>
  );
}

function Transcript({ call }: { readonly call: Detail }): React.JSX.Element {
  return (
    <Card title="Transcript">
      {call.transcript && call.transcript.length > 0 ? (
        <ol className="flex flex-col gap-2 text-sm">
          {call.transcript.map((turn, index) => (
            <li
              // Turns have no id; their order never changes.
              key={index}
              className={
                turn.role === 'assistant'
                  ? 'max-w-[85%] self-start rounded-2xl bg-brand-soft p-3'
                  : 'max-w-[85%] self-end rounded-2xl bg-canvas p-3 ring-1 ring-border'
              }
            >
              <span className="block text-xs text-ink-muted">
                {turn.role === 'assistant' ? 'Asha' : call.shopkeeperName}
              </span>
              {turn.content}
              {call.transcriptEnglish?.[index] ? (
                <span className="mt-1 block border-t border-border pt-1 text-xs text-ink-muted">
                  {call.transcriptEnglish[index]}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-muted">No transcript for this call.</p>
      )}
    </Card>
  );
}

function Tools({ call }: { readonly call: Detail }): React.JSX.Element {
  return (
    <Card title={`Tool calls (${call.toolEvents.length})`}>
      <ul className="flex flex-col gap-2 text-sm">
        {call.toolEvents.map((event) => (
          <li key={`${event.createdAt}:${event.tool}`}>
            <details className="rounded-xl bg-canvas p-3">
              <summary className="cursor-pointer font-medium">
                {event.tool}
                {event.durationMs === null ? '' : ` · ${event.durationMs} ms`}
              </summary>
              <pre className="mt-2 overflow-x-auto text-xs">
                {JSON.stringify({ sent: event.args, got: event.result }, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CallDetail({ call }: { readonly call: Detail }): React.JSX.Element {
  return (
    <>
      <a href="/calls" className="text-sm font-medium text-brand underline">
        ← All calls
      </a>
      <Facts call={call} />
      <FollowUp call={call} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Transcript call={call} />
        <Tools call={call} />
      </div>
    </>
  );
}
