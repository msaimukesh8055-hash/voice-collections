// web/src/features/ops/TraceView.tsx
// /ops?id=<trace id>: every step of one request in order, from the first byte to the last
// database write, across functions (a kick to the follow-up worker keeps the same trace).
// 2026-11-23: shown as the readable timeline (PlainTimeline), the raw steps in its technical fold.
import { AddTestCase } from '../evals/AddTestCase.tsx';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { Trace } from '../../lib/opsSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { PlainTimeline } from '../trace/PlainTimeline.tsx';
import { buildPlainTrace } from '../trace/plainTrace.ts';

/** WhatsApp requests can be saved as a test case (Saim, 2026-11-20). */
const WHATSAPP_SOURCE = 'whatsapp-webhook';

function Timeline({
  trace,
  dashboard,
}: {
  readonly trace: Trace;
  readonly dashboard: DashboardApi;
}): React.JSX.Element {
  const fromWhatsApp = trace.steps.some((step) => step.source === WHATSAPP_SOURCE);
  return (
    <>
      <p className="break-all font-mono text-xs text-ink-muted">
        {trace.steps[0] ? `${dateTime(trace.steps[0].createdAt)} · ` : ''}trace {trace.traceId}
      </p>
      <PlainTimeline
        title="What happened"
        trace={buildPlainTrace({ steps: trace.steps })}
        steps={trace.steps}
      />
      {fromWhatsApp ? (
        <AddTestCase dashboard={dashboard} source="whatsapp" refId={trace.traceId} />
      ) : null}
    </>
  );
}

export function TraceView({
  dashboard,
  id,
}: {
  readonly dashboard: DashboardApi;
  readonly id: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.trace(id), `trace:${id}`);
  return (
    <>
      <a
        href="/ops"
        className="text-sm font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
      >
        ← All ops
      </a>
      <LoadState state={state}>
        {(trace: Trace) => <Timeline trace={trace} dashboard={dashboard} />}
      </LoadState>
    </>
  );
}
