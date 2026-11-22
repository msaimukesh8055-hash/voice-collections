// web/src/features/munshi-calls/MunshiCallsPage.tsx
// Live evals for Munshi (Saim, 2026-11-20): /munshi-calls lists the owner's calls to Munshi;
// /munshi-calls?id=… is one call's report, laid out like Asha's call page: facts, Munshi's
// scorecard (his own guardrails), "Tools: needed vs ran", the transcript, then this call's steps.
// The Munshi page links here when a call ends.
import type { DashboardApi, OwnerCallDetail, OwnerCallRow } from '../../lib/dashboardApi.ts';
import { TranscriptCard } from '../calls/CallDetail.tsx';
import { type CallFilter, FilteredCard, onlyFiltered } from '../calls/callFilter.tsx';
import { Scorecard } from '../calls/Scorecard.tsx';
import { AddTestCase } from '../evals/AddTestCase.tsx';
import { ToolUse } from '../calls/ToolUse.tsx';
import { dateTime, duration, formatInr } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { TraceSteps } from '../ops/TraceView.tsx';

export const MUNSHI_CALLS_PATH = '/munshi-calls';

function startedAt(call: OwnerCallRow): string {
  return call.acceptedAt ?? call.issuedAt;
}

function Facts({ call }: { readonly call: OwnerCallDetail }): React.JSX.Element {
  const facts = [
    ['When', dateTime(startedAt(call))],
    ['Agent', 'Munshi (owner line)'],
    ['Status', call.status.replace('_', ' ')],
    ['Length', duration(call.durationSeconds)],
    ['Cost', formatInr(call.cost.inr)],
  ] as const;
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Owner call</p>
      <h1 className="text-2xl font-semibold">Call with Munshi</h1>
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

export function MunshiCallReport({
  call,
  action,
}: {
  readonly call: OwnerCallDetail;
  /** Shown under the scorecard, e.g. "Add as a test case". */
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <a href={MUNSHI_CALLS_PATH} className="text-sm font-medium text-brand underline">
        ← All Munshi calls
      </a>
      <Facts call={call} />
      <Scorecard card={call.scorecard} />
      {action}
      <ToolUse rows={call.scorecard.toolUse} events={call.toolEvents} />
      <TranscriptCard
        turns={call.transcript}
        english={call.transcriptEnglish}
        agent="Munshi"
        other="You"
      />
      {call.trace.length > 0 ? (
        <TraceSteps title="This call, step by step" steps={call.trace} />
      ) : null}
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
  const state = useLoad(() => dashboard.ownerCall(id), `owner-call:${id}`);
  return (
    <LoadState state={state}>
      {(call: OwnerCallDetail) => (
        <MunshiCallReport
          call={call}
          action={<AddTestCase dashboard={dashboard} source="munshi_call" refId={call.id} />}
        />
      )}
    </LoadState>
  );
}

function CallList({ calls }: { readonly calls: readonly OwnerCallRow[] }): React.JSX.Element {
  if (calls.length === 0) {
    return <p className="text-sm text-ink-muted">No calls to Munshi yet.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-ink-muted">
        <tr>
          <th className="pb-1 pr-3 font-medium">When</th>
          <th className="pb-1 pr-3 font-medium">Status</th>
          <th className="pb-1 pr-3 font-medium">Length</th>
          <th className="pb-1 font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {calls.map((call) => (
          <tr key={call.id} className="border-t border-border">
            <td className="py-2 pr-3">
              <a
                href={`${MUNSHI_CALLS_PATH}?id=${encodeURIComponent(call.id)}`}
                className="font-medium text-brand underline"
              >
                {dateTime(startedAt(call))}
              </a>
            </td>
            <td className="py-2 pr-3">{call.status.replace('_', ' ')}</td>
            <td className="py-2 pr-3">{duration(call.durationSeconds)}</td>
            <td className="py-2">{formatInr(call.cost.inr)}</td>
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
  const state = useLoad(dashboard.ownerCalls, 'owner-calls');
  return (
    <LoadState state={state}>
      {(calls: readonly OwnerCallRow[]) => {
        const shown = onlyFiltered(calls, filter);
        return (
          <FilteredCard
            title="Munshi calls"
            page={MUNSHI_CALLS_PATH}
            filter={filter}
            shown={shown.length}
          >
            <CallList calls={shown} />
          </FilteredCard>
        );
      }}
    </LoadState>
  );
}

export function MunshiCallsPage({
  dashboard,
  id,
  filter = null,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string | null;
  /** From Agent health: show only these calls (callFilter.tsx). */
  readonly filter?: CallFilter | null;
}): React.JSX.Element {
  return (
    <Layout current={MUNSHI_CALLS_PATH} dashboard={dashboard}>
      {id ? <One dashboard={dashboard} id={id} /> : <All dashboard={dashboard} filter={filter} />}
    </Layout>
  );
}
