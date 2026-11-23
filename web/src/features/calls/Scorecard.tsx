// web/src/features/calls/Scorecard.tsx
// Live evals (Saim, 2026-11-20): the call's scorecard at the top of its page, worked out on the
// server from what was stored (scorecard.ts): a verdict, then each group of checks with the
// measured value. Any guardrail failure fails the call. The known limits of the checks stay in
// the data (gaps) and the docs; Saim took them off the page on 2026-11-20.
// 2026-11-23: call pages hide the Tools, Latency and Cost groups (their numbers are in the
// timeline and the facts); a miss in a hidden group still shows as one verdict line.
import type { Scorecard as Card } from '../../lib/dashboardApi.ts';
import { Card as Section } from '../dashboard/Layout.tsx';
import { type Tone, TONE_CLASSES } from '../ops/opsFormat.ts';
import { checkHelp } from './checkHelp.ts';

type Status = Card['groups'][number]['checks'][number]['status'];
type Group = Card['groups'][number];

const STATUS: Readonly<Record<Status, { readonly label: string; readonly tone: Tone }>> = {
  pass: { label: 'Pass', tone: 'good' },
  warn: { label: 'Check', tone: 'warn' },
  fail: { label: 'Fail', tone: 'bad' },
  na: { label: 'n/a', tone: 'plain' },
};

const VERDICT: Readonly<Record<Card['verdict'], { readonly label: string; readonly tone: Tone }>> =
  {
    good: { label: 'went well', tone: 'good' },
    check: { label: '⚠ Worth a look', tone: 'warn' },
    failed: { label: '❌ A guardrail failed', tone: 'bad' },
  };

function verdictLabel(verdict: Card['verdict'], noun: string): string {
  return verdict === 'good' ? `✅ ${noun} went well` : VERDICT[verdict].label;
}

const CALL_NOTE =
  "worked out in code from this call's records, except Tone: an AI judge (Gemini, free tier) scores it once and it is kept";

/** The plain-English line under a check: what it means, and what a miss means. */
export function CheckExplained({
  id,
  missed,
}: {
  readonly id: string;
  readonly missed: boolean;
}): React.JSX.Element | null {
  const help = checkHelp(id);
  if (!help) return null;
  return (
    <span className="col-span-2 text-xs text-ink">
      {help.means}
      {missed ? <span className="block text-ink-muted">Why it matters: {help.miss}</span> : null}
    </span>
  );
}

function GroupCard({ group }: { readonly group: Group }): React.JSX.Element {
  return (
    <div className="rounded-xl bg-canvas p-3 ring-1 ring-border">
      <h3 className="mb-2 text-sm font-semibold">{group.name}</h3>
      <ul className="flex flex-col gap-2">
        {group.checks.map((check) => (
          <li key={check.id} className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
            <span>{check.label}</span>
            <span className={`text-right font-medium ${TONE_CLASSES[STATUS[check.status].tone]}`}>
              {STATUS[check.status].label}
            </span>
            <span className="col-span-2 text-xs text-ink-muted">{check.value}</span>
            <CheckExplained
              id={check.id}
              missed={check.status === 'fail' || check.status === 'warn'}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Readable traces (2026-11-23): groups whose numbers now live in the call's timeline. */
export const TIMELINE_GROUPS = ['Tools', 'Latency', 'Cost'] as const;

function issues(groups: readonly Group[]): { readonly group: string; readonly label: string }[] {
  return groups.flatMap((group) =>
    group.checks
      .filter((check) => check.status === 'fail' || check.status === 'warn')
      .map((check) => ({ group: group.name, label: check.label })),
  );
}

/** A hidden group's misses, as verdict lines only, pointing at the timeline. */
function ElsewhereIssues({
  groups,
}: {
  readonly groups: readonly Group[];
}): React.JSX.Element | null {
  const found = issues(groups);
  if (found.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 text-sm">
      {found.map((issue) => (
        <li key={`${issue.group}:${issue.label}`} className={TONE_CLASSES.warn}>
          ⚠ {issue.group}: {issue.label}{' '}
          <span className="text-ink-muted">(details in “What happened in the call”)</span>
        </li>
      ))}
    </ul>
  );
}

export function Scorecard({
  card,
  noun = 'Call',
  note = CALL_NOTE,
  hide = [],
}: {
  readonly card: Card;
  /** "Call", or "Message" on the WhatsApp page (2026-11-22). */
  readonly noun?: string;
  readonly note?: string;
  /** Groups shown elsewhere on the page (the timeline); only their misses are listed here. */
  readonly hide?: readonly string[];
}): React.JSX.Element {
  const verdict = VERDICT[card.verdict];
  const shown = card.groups.filter((group) => !hide.includes(group.name));
  const hidden = card.groups.filter((group) => hide.includes(group.name));
  return (
    <Section title={`${noun} scorecard`}>
      <p className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-lg font-semibold ${TONE_CLASSES[verdict.tone]}`}>
          {verdictLabel(card.verdict, noun)}
        </span>
        <span className="text-sm text-ink-muted">
          {card.passed} of {card.applicable} checks passed · {note}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((group) => (
          <GroupCard key={group.name} group={group} />
        ))}
      </div>
      <ElsewhereIssues groups={hidden} />
    </Section>
  );
}
