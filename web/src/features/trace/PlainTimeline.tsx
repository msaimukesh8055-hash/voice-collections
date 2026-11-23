// web/src/features/trace/PlainTimeline.tsx
// Readable traces (Saim, 2026-11-23): "What happened in the call" (or in the message): the summary
// line, then each step in plain English with its time since the start, the tool's real name
// small, flags (failed, slow, duplicate), what a tool sent and got back on a click, and a link to
// Langfuse on AI steps (where the prompt and answer are). Tools that did not run get one line each.
// Mic signals and the raw steps sit in a "Technical details" fold. Replaces the old tool tables
// and the raw step list on the Asha and Munshi call pages, the WhatsApp report and the Ops trace.
import type { TraceStep } from '../../lib/opsSchemas.ts';
import { Card } from '../dashboard/Layout.tsx';
import { RawSteps } from './RawSteps.tsx';
import { TONE_CLASSES } from '../ops/opsFormat.ts';
import {
  type AiInfo,
  type Flag,
  msText,
  type NotRun,
  offsetText,
  type PlainItem,
  type PlainTrace,
} from './plainTrace.ts';

const FLAG_TEXT: Readonly<Record<Flag, { readonly label: string; readonly className: string }>> = {
  failed: { label: 'failed', className: 'bg-danger/10 text-danger ring-danger/30' },
  refused: { label: 'did not go through', className: 'bg-warning/10 text-warning ring-warning/30' },
  slow: { label: 'slow, over 1 s', className: 'bg-warning/10 text-warning ring-warning/30' },
  duplicate: {
    label: 'called again within 5 s',
    className: 'bg-warning/10 text-warning ring-warning/30',
  },
};

function Flags({ flags }: { readonly flags: readonly Flag[] }): React.JSX.Element | null {
  if (flags.length === 0) return null;
  return (
    <>
      {flags.map((flag) => (
        <span
          key={flag}
          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${FLAG_TEXT[flag].className}`}
        >
          {FLAG_TEXT[flag].label}
        </span>
      ))}
    </>
  );
}

function tokens(ai: AiInfo): string | null {
  if (ai.tokensIn === null) return null;
  return `${ai.tokensIn} → ${ai.tokensOut ?? 0} tokens`;
}

function AiLine({
  ai,
  durationMs,
}: {
  readonly ai: AiInfo;
  readonly durationMs: number | null;
}): React.JSX.Element {
  const parts = [
    ai.model ? `${ai.provider} (${ai.model})` : ai.provider,
    durationMs === null ? null : msText(durationMs),
    tokens(ai),
  ].filter((part): part is string => part !== null);
  return (
    <p className="text-xs text-ink-muted">
      {parts.join(' · ')}
      {ai.url ? (
        <>
          {' · '}
          <a href={ai.url} target="_blank" rel="noreferrer" className="text-brand underline">
            Prompt and answer in Langfuse ↗
          </a>
        </>
      ) : null}
    </p>
  );
}

function SentGot({ item }: { readonly item: PlainItem }): React.JSX.Element | null {
  if (!item.sentGot) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-brand">What it sent and got back</summary>
      <pre className="mt-1 overflow-x-auto rounded-xl bg-canvas p-2">
        {JSON.stringify(item.sentGot, null, 2)}
      </pre>
    </details>
  );
}

function Item({ item }: { readonly item: PlainItem }): React.JSX.Element {
  const showTime = item.tool !== null && !item.ai && item.durationMs !== null;
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-x-3 py-2 text-sm">
      <span className="font-mono text-xs text-ink-muted">{offsetText(item.atMs)}</span>
      <div>
        <p>
          <span className={`font-medium ${TONE_CLASSES[item.tone]}`}>{item.title}</span>
          {showTime ? (
            <span className="ml-2 text-xs text-ink-muted">{msText(item.durationMs ?? 0)}</span>
          ) : null}
          <span className="ml-2 font-mono text-xs text-ink-muted">{item.name}</span>
          <Flags flags={item.flags} />
        </p>
        {item.note ? <p className="text-xs text-ink-muted">{item.note}</p> : null}
        {item.ai ? <AiLine ai={item.ai} durationMs={item.durationMs} /> : null}
        <SentGot item={item} />
      </div>
    </li>
  );
}

function NotRunList({ rows }: { readonly rows: readonly NotRun[] }): React.JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <h3 className="mb-1 text-sm font-semibold">Tools that did not run</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={row.tool} className={row.missed ? TONE_CLASSES.bad : 'text-ink-muted'}>
            <span className="font-mono text-xs">{row.tool}</span>: {row.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Technical({
  trace,
  steps,
}: {
  readonly trace: PlainTrace;
  readonly steps: readonly TraceStep[];
}): React.JSX.Element {
  return (
    <details className="mt-3 border-t border-border pt-3 text-sm">
      <summary className="cursor-pointer font-medium">Technical details</summary>
      {trace.technical.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          {trace.technical.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-3 text-xs font-medium">Every recorded step ({steps.length})</p>
      <RawSteps steps={steps} />
    </details>
  );
}

export function PlainTimeline({
  title,
  trace,
  steps,
}: {
  readonly title: string;
  readonly trace: PlainTrace;
  /** The recorded steps, for the technical fold. */
  readonly steps: readonly TraceStep[];
}): React.JSX.Element {
  return (
    <Card title={title}>
      <p className="text-sm font-medium">{trace.summary.join(' · ')}</p>
      {trace.items.length > 0 ? (
        <ol className="mt-2 divide-y divide-border">
          {trace.items.map((item) => (
            <Item key={item.key} item={item} />
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">No steps recorded.</p>
      )}
      <NotRunList rows={trace.notRun} />
      {steps.length > 0 ? <Technical trace={trace} steps={steps} /> : null}
    </Card>
  );
}
