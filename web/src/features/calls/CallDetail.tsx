// web/src/features/calls/CallDetail.tsx
// One call (SPEC §12 /calls): who, live or simulated, tone level, length and cost; the
// follow-up agent's decision (rule or agent, and why); the WhatsApp summary; the transcript; and
// every tool Asha called (the call token is removed server-side).
// Live evals (2026-11-20): the call's scorecard under the facts.
// Readable traces (Saim, 2026-11-23): one "What happened in the call" timeline replaces the
// tool tables and the raw step list: each step in plain English, tools with what they sent and
// got back, tools that did not run, and the mic signals in a technical fold.
// Telugu and Hindi lines show their English (Sarvam Translate) underneath, in small grey text.
import type { ReactNode } from 'react';
import type { CallDetail as Detail } from '../../lib/dashboardApi.ts';
import { dateTime, duration, formatInr } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';
import { type PageSection, Sections } from '../dashboard/Sections.tsx';
import { PlainTimeline } from '../trace/PlainTimeline.tsx';
import { timelineBadge, TIMELINE_TITLE, verdictBadge } from '../trace/badges.ts';
import { buildPlainTrace, type PlainTrace } from '../trace/plainTrace.ts';
import { Scorecard, TIMELINE_GROUPS } from './Scorecard.tsx';

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

type Turns = NonNullable<Detail['transcript']>;

/** A call's turns, the agent's on the left; English under Telugu and Hindi lines. Shared with the
 * Munshi call report. */
export function TranscriptCard({
  turns,
  english,
  agent,
  other,
}: {
  readonly turns: Turns | null;
  readonly english: readonly (string | null)[] | null;
  readonly agent: string;
  readonly other: string;
}): React.JSX.Element {
  return (
    <Card title="Transcript">
      {turns && turns.length > 0 ? (
        <ol className="flex flex-col gap-2 text-sm">
          {turns.map((turn, index) => (
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
                {turn.role === 'assistant' ? agent : other}
              </span>
              {turn.content}
              {english?.[index] ? (
                <span className="mt-1 block border-t border-border pt-1 text-xs text-ink-muted">
                  {english[index]}
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

/** Readable traces (2026-11-23): the call's steps, tools and follow-up in one plain timeline. */
function callTrace(call: Detail): PlainTrace {
  return buildPlainTrace({
    steps: call.trace ?? [],
    events: call.toolEvents,
    toolUse: call.scorecard?.toolUse ?? [],
    agent: 'Asha',
  });
}

function sections(call: Detail, action: ReactNode): PageSection[] {
  const trace = callTrace(call);
  const scorecard: PageSection[] = call.scorecard
    ? [
        {
          id: 'scorecard',
          title: 'Call scorecard',
          badge: verdictBadge(call.scorecard.verdict),
          content: (
            <>
              <Scorecard card={call.scorecard} hide={TIMELINE_GROUPS} />
              {action}
            </>
          ),
        },
      ]
    : [];
  return [
    ...scorecard,
    {
      id: 'timeline',
      title: TIMELINE_TITLE,
      badge: timelineBadge(trace),
      content: <PlainTimeline title={TIMELINE_TITLE} trace={trace} steps={call.trace ?? []} />,
    },
    { id: 'after', title: 'After the call', content: <FollowUp call={call} /> },
    {
      id: 'transcript',
      title: 'Transcript',
      content: (
        <TranscriptCard
          turns={call.transcript}
          english={call.transcriptEnglish}
          agent="Asha"
          other={call.shopkeeperName}
        />
      ),
    },
  ];
}

export function CallDetail({
  call,
  action,
}: {
  readonly call: Detail;
  /** Shown under the scorecard, e.g. "Add as a test case". */
  readonly action?: ReactNode;
}): React.JSX.Element {
  return (
    <>
      <a href="/calls" className="text-sm font-medium text-brand underline">
        ← All calls
      </a>
      <Sections top={<Facts call={call} />} sections={sections(call, action)} />
    </>
  );
}
