// web/src/features/ops/TraceView.tsx
// /ops?id=<trace id>: every step of one request in order, from the first byte to the last
// database write, across functions (a kick to the follow-up worker keeps the same trace).
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { Trace, TraceStep } from '../../lib/opsSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { Card, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { sinceStart, type Tone, TONE_CLASSES } from './opsFormat.ts';

const STATUS: Readonly<Record<TraceStep['status'], { label: string; tone: Tone }>> = {
  ok: { label: 'OK', tone: 'good' },
  warn: { label: 'Warning', tone: 'warn' },
  error: { label: 'Error', tone: 'bad' },
};
/** Already shown in their own place on the row. */
const SHOWN_ELSEWHERE = ['ms', 'duration_ms', 'provider', 'tokens_in', 'tokens_out'];

function facts(step: TraceStep): string {
  const parts = [
    step.durationMs === null ? null : `${step.durationMs} ms`,
    step.provider,
    step.tokensIn === null ? null : `${step.tokensIn} tokens in, ${step.tokensOut ?? 0} out`,
    step.errorCode,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

function details(step: TraceStep): string {
  return Object.entries(step.detail)
    .filter(([key]) => !SHOWN_ELSEWHERE.includes(key))
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

function Step({
  step,
  start,
}: {
  readonly step: TraceStep;
  readonly start: string;
}): React.JSX.Element {
  const status = STATUS[step.status];
  const extra = details(step);
  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-x-3 py-2 text-sm">
      <span className="font-mono text-xs text-ink-muted">{sinceStart(start, step.createdAt)}</span>
      <div>
        <p>
          <span className="font-mono text-xs">{step.step}</span>{' '}
          <span className={`font-medium ${TONE_CLASSES[status.tone]}`}>{status.label}</span>
        </p>
        <p className="text-ink-muted">
          {step.source}
          {facts(step) ? ` · ${facts(step)}` : ''}
        </p>
        {extra ? <p className="break-words text-xs text-ink-muted">{extra}</p> : null}
      </div>
    </li>
  );
}

function Timeline({ trace }: { readonly trace: Trace }): React.JSX.Element {
  const start = trace.steps[0]?.createdAt ?? '';
  const failed = trace.steps.filter((step) => step.status === 'error').length;
  return (
    <Card title="Trace">
      <p className="text-sm text-ink-muted">
        {start ? `${dateTime(start)} · ` : ''}
        {trace.steps.length} steps ·{' '}
        <span className={TONE_CLASSES[failed > 0 ? 'bad' : 'good']}>
          {failed > 0 ? `${failed} failed` : 'no errors'}
        </span>
      </p>
      <p className="break-all font-mono text-xs text-ink-muted">{trace.traceId}</p>
      <ol className="mt-3 divide-y divide-border">
        {trace.steps.map((step, index) => (
          <Step key={`${step.createdAt}:${step.step}:${index}`} step={step} start={start} />
        ))}
      </ol>
    </Card>
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
      <LoadState state={state}>{(trace: Trace) => <Timeline trace={trace} />}</LoadState>
    </>
  );
}
