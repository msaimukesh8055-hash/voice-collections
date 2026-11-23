// web/src/features/trace/RawSteps.tsx
// Every recorded step of a trace, raw: name, status, function, duration, provider, tokens and the
// step's other details, each with its time since the first step. Since 2026-11-23 this sits in
// the "Technical details" fold of the readable timeline (PlainTimeline) for engineers.
import type { TraceStep } from '../../lib/opsSchemas.ts';
import { sinceStart, type Tone, TONE_CLASSES } from '../ops/opsFormat.ts';

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

/** Every recorded step, raw, with its time since the first one: the "Technical details" fold of
 * the readable timeline (PlainTimeline). */
export function RawSteps({ steps }: { readonly steps: readonly TraceStep[] }): React.JSX.Element {
  const start = steps[0]?.createdAt ?? '';
  return (
    <ol className="mt-1 divide-y divide-border">
      {steps.map((step, index) => (
        <Step key={`${step.createdAt}:${step.step}:${index}`} step={step} start={start} />
      ))}
    </ol>
  );
}
