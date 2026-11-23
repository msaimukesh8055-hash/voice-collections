// web/src/features/evals/ModelChoice.tsx
// "Model choice" (Saim, 2026-11-23): the WhatsApp brain's eval messages, same prompt and same
// checker, through each model on its own. One row per model: accuracy, money mistakes, Telugu and
// Hindi, typical and slowest reply, cost per 1,000 messages, and whether it would pass the gate.
// Read-only; the numbers are what evals:bakeoff stored.
import type { ModelRun } from '../../lib/modelChoiceSchemas.ts';
import { dateTime, formatInr } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

const CELL = 'px-2 py-1.5 align-top';
const HEAD = `${CELL} text-left text-xs font-medium text-ink-muted`;
const MS_PER_SECOND = 1000;

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

function percentOf(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function Row({ run }: { readonly run: ModelRun }): React.JSX.Element {
  const m = run.metrics;
  return (
    <tr className="border-t border-border">
      <td className={`${CELL} font-mono text-xs`}>{m.model}</td>
      <td className={CELL}>
        {percentOf(m.casesPassed, m.cases)}{' '}
        <span className="text-xs text-ink-muted">
          ({m.casesPassed}/{m.cases})
        </span>
      </td>
      <td className={`${CELL} ${TONE_CLASSES[m.moneyFailures === 0 ? 'good' : 'bad']}`}>
        {m.moneyFailures} of {m.moneyCases}
      </td>
      <td className={CELL}>
        {m.indicPassed}/{m.indicCases}
      </td>
      <td className={CELL}>{seconds(m.p50Ms)}</td>
      <td className={CELL}>{seconds(m.maxMs)}</td>
      <td className={CELL}>{formatInr(m.costPer1000Inr)}</td>
      <td className={`${CELL} font-medium ${TONE_CLASSES[m.passed ? 'good' : 'bad']}`}>
        {m.passed ? 'Passes' : 'Fails'}
        {m.failedCalls > 0 ? (
          <span className="block text-xs font-normal text-ink-muted">
            {m.failedCalls} call(s) got no answer
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function notesOf(runs: readonly ModelRun[]): readonly string[] {
  return [...new Set(runs.map((run) => run.metrics.priceNote).filter(Boolean))];
}

function Notes({ runs }: { readonly runs: readonly ModelRun[] }): React.JSX.Element {
  return (
    <ul className="mt-2 list-disc pl-5 text-xs text-ink-muted">
      <li>
        Accuracy: messages turned into the right command, name and amount. Money mistakes: money
        messages answered wrongly (each one fails the gate on its own). A call that got no answer
        counts as a miss, not as a money mistake.
      </li>
      <li>Typical reply is the middle time; slowest is the longest. Calls from this PC.</li>
      <li>
        Per 1,000 messages: average tokens per message × price, with 18% GST.{' '}
        {notesOf(runs).join(' ')}
      </li>
    </ul>
  );
}

export function ModelChoice({
  runs,
}: {
  readonly runs: readonly ModelRun[];
}): React.JSX.Element | null {
  if (runs.length === 0) return null;
  const newest = runs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  return (
    <Card title="Model choice">
      <p className="text-sm text-ink-muted">
        Which model should run the WhatsApp brain? Every brain eval message, same prompt and same
        checker, sent to each model on its own: no fallback, and no code parser first (in the
        product, code answers fixed commands before any model is asked). Run{' '}
        {dateTime(newest.createdAt)}.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Model</th>
              <th className={HEAD}>Accuracy</th>
              <th className={HEAD}>Money mistakes</th>
              <th className={HEAD}>Telugu / Hindi</th>
              <th className={HEAD}>Typical reply</th>
              <th className={HEAD}>Slowest</th>
              <th className={HEAD}>Per 1,000 messages</th>
              <th className={HEAD}>Brain gate</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Row key={run.id} run={run} />
            ))}
          </tbody>
        </table>
      </div>
      <Notes runs={runs} />
    </Card>
  );
}
