// web/src/features/evals/CaseHistory.tsx
// "How it got fixed" (Saim, 2026-11-22): every case across the recent runs, oldest on the left,
// a "what changed" line for each run, and for a case that failed and now passes, a before / after
// view: the last failing conversation, what changed, and the passing one. Whether the prompt
// changed comes from the prompt hash; the note is written per run (run-notes.ts).
import { useState } from 'react';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type {
  CaseHistory as History,
  EvalCase,
  HistoryCase,
  HistoryRun,
} from '../../lib/evalsSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

const CHANGE_LABELS: Readonly<Record<HistoryRun['change'], string>> = {
  first: 'First run',
  prompt: 'Prompt changed',
  code: 'Our code fixed, same prompt',
  test: 'Test setup or checks fixed',
  rerun: 'Same prompt, run again',
};

const CELL = 'px-2 py-1.5 align-top';
const HEAD = `${CELL} text-left text-xs font-medium text-ink-muted`;

type Opened =
  | { readonly kind: 'none' }
  | { readonly kind: 'cell'; readonly runId: string; readonly caseId: string }
  | { readonly kind: 'compare'; readonly caseId: string };

function shortRun(run: HistoryRun): string {
  return dateTime(run.createdAt);
}

/** "prompt v9 · Sarvam v7": our prompt name and Sarvam's own version counter, which differ. */
function versionOf(run: HistoryRun): string {
  const ours = run.promptName ? `prompt ${run.promptName}` : '';
  const theirs = run.appVersion === null ? '' : `Sarvam v${run.appVersion}`;
  return [ours, theirs].filter(Boolean).join(' · ');
}

function stepName(run: HistoryRun): string {
  return run.promptName ? `prompt ${run.promptName}` : shortRun(run);
}

/** One case across the runs it was in, e.g. "✓ prompt v6 → ✗ prompt v7 → ✓ prompt v8". Runs
 * on the same prompt with the same result are shown once. */
export function storyOf(runs: readonly HistoryRun[], evalCase: HistoryCase): string {
  const steps: string[] = [];
  let last = '';
  for (const run of runs) {
    const result = evalCase.results[run.id];
    if (result === undefined) continue;
    const step = `${result ? '✓' : '✗'} ${stepName(run)}`;
    if (step !== last) steps.push(step);
    last = step;
  }
  return steps.join(' → ');
}

/** It passed before it failed: a later change broke it, and a later one fixed it again. */
export function brokeThenFixed(runs: readonly HistoryRun[], evalCase: HistoryCase): boolean {
  const failedAt = runs.findIndex((run) => run.id === evalCase.lastFailedIn);
  if (!evalCase.fixedIn || failedAt < 0) return false;
  return runs.slice(0, failedAt).some((run) => evalCase.results[run.id] === true);
}

function failures(evalCase: EvalCase): readonly string[] {
  const judged = evalCase.scores.verdicts
    .filter((verdict) => !verdict.passed)
    .map((verdict) => `${verdict.name}: ${verdict.reasoning || 'failed'}`);
  const checked = evalCase.scores.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.detail || 'failed'}`);
  return [...judged, ...checked];
}

function Conversation({
  dashboard,
  runId,
  caseId,
  title,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly runId: string;
  readonly caseId: string;
  readonly title: string;
}): React.JSX.Element {
  const state = useLoad(() => dashboard.evalCase(runId, caseId), `eval-case:${runId}:${caseId}`);
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-canvas p-3 ring-1 ring-border">
      <h4 className="text-sm font-semibold">{title}</h4>
      <LoadState state={state}>
        {(evalCase: EvalCase) => {
          const failed = failures(evalCase);
          return (
            <>
              <p className={`text-sm font-medium ${TONE_CLASSES[evalCase.pass ? 'good' : 'bad']}`}>
                {evalCase.pass ? 'Pass' : 'Fail'}
              </p>
              {failed.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-xs text-danger">
                  {failed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-brand-soft p-2 text-xs text-ink">
                {evalCase.transcript}
              </pre>
            </>
          );
        }}
      </LoadState>
    </div>
  );
}

function ChangeLine({ run }: { readonly run: HistoryRun }): React.JSX.Element {
  return (
    <li className="text-sm">
      <span className="font-medium">{shortRun(run)}</span>
      {versionOf(run) ? <span className="ml-2 text-xs">{versionOf(run)}</span> : null}
      <span
        className={`ml-2 rounded-full px-2 py-0.5 text-xs ring-1 ring-border ${
          run.change === 'prompt' ? 'bg-brand-soft text-brand' : 'text-ink-muted'
        }`}
      >
        {CHANGE_LABELS[run.change]}
      </span>
      <span className={`ml-2 text-xs ${TONE_CLASSES[run.passed ? 'good' : 'bad']}`}>
        {run.casesPassed}/{run.cases} · {run.passed ? 'passed' : 'failed'}
      </span>
      {run.note ? <span className="block text-ink-muted">{run.note}</span> : null}
    </li>
  );
}

function BeforeAfter({
  dashboard,
  history,
  evalCase,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
  readonly evalCase: HistoryCase;
}): React.JSX.Element | null {
  const before = history.runs.find((run) => run.id === evalCase.lastFailedIn);
  const after = history.runs.find((run) => run.id === evalCase.fixedIn);
  if (!before || !after) return null;
  return (
    <section
      aria-label={`Before and after: ${evalCase.scenarioId}`}
      className="mt-3 rounded-xl p-3 ring-1 ring-brand"
    >
      <h4 className="text-sm font-semibold">
        {evalCase.scenarioId} · {evalCase.name}: how it got fixed
      </h4>
      <p className="mt-1 text-sm font-medium">{storyOf(history.runs, evalCase)}</p>
      <p className="mt-1 text-sm">
        {brokeThenFixed(history.runs, evalCase) ? 'Broke on ' : 'Failed on '}
        {stepName(before)}, fixed on {stepName(after)} ({CHANGE_LABELS[after.change]}).
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        <span className="font-medium">Everything else in that run: </span>
        {after.note ?? 'No note written for this run.'}
      </p>
      <div className="mt-3 flex flex-col gap-3 lg:flex-row">
        <Conversation
          dashboard={dashboard}
          runId={before.id}
          caseId={evalCase.scenarioId}
          title={`Before · ${shortRun(before)}`}
        />
        <Conversation
          dashboard={dashboard}
          runId={after.id}
          caseId={evalCase.scenarioId}
          title={`After · ${shortRun(after)}`}
        />
      </div>
    </section>
  );
}

function Cell({
  result,
  label,
  onOpen,
}: {
  readonly result: boolean | undefined;
  readonly label: string;
  readonly onOpen: () => void;
}): React.JSX.Element {
  if (result === undefined) return <span className="text-ink-muted">—</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={`rounded px-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand ${
        TONE_CLASSES[result ? 'good' : 'bad']
      }`}
    >
      {result ? '✓' : '✗'}
    </button>
  );
}

function CaseRow({
  history,
  evalCase,
  onOpen,
}: {
  readonly history: History;
  readonly evalCase: HistoryCase;
  readonly onOpen: (opened: Opened) => void;
}): React.JSX.Element {
  function compare(): void {
    onOpen({ kind: 'compare', caseId: evalCase.scenarioId });
  }
  return (
    <tr className="border-t border-border">
      <td className={CELL}>
        <span className="font-mono text-xs">{evalCase.scenarioId}</span>
        <span className="block">{evalCase.name}</span>
      </td>
      {history.runs.map((run) => {
        function open(): void {
          onOpen({ kind: 'cell', runId: run.id, caseId: evalCase.scenarioId });
        }
        const result = evalCase.results[run.id];
        const outcome = result ? 'passed' : 'failed';
        return (
          <td key={run.id} className={`${CELL} text-center`}>
            <Cell
              result={result}
              label={`${evalCase.scenarioId} ${outcome} on ${shortRun(run)}`}
              onOpen={open}
            />
          </td>
        );
      })}
      <td className={CELL}>
        {evalCase.fixedIn ? (
          <button
            type="button"
            onClick={compare}
            className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {brokeThenFixed(history.runs, evalCase) ? 'Broke, then fixed' : 'Fixed'} · before /
            after
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function Opened({
  dashboard,
  history,
  opened,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
  readonly opened: Opened;
}): React.JSX.Element | null {
  if (opened.kind === 'none') return null;
  if (opened.kind === 'compare') {
    const evalCase = history.cases.find((one) => one.scenarioId === opened.caseId);
    return evalCase ? (
      <BeforeAfter dashboard={dashboard} history={history} evalCase={evalCase} />
    ) : null;
  }
  const run = history.runs.find((one) => one.id === opened.runId);
  if (!run) return null;
  return (
    <div className="mt-3">
      <Conversation
        dashboard={dashboard}
        runId={run.id}
        caseId={opened.caseId}
        title={`${opened.caseId} · ${shortRun(run)}`}
      />
    </div>
  );
}

function HeadRow({ runs }: { readonly runs: readonly HistoryRun[] }): React.JSX.Element {
  return (
    <thead>
      <tr>
        <th className={HEAD}>Case</th>
        {runs.map((run) => (
          <th key={run.id} className={`${HEAD} text-center`}>
            {shortRun(run)}
            <span className="block font-normal">{versionOf(run)}</span>
            <span className="block font-normal">
              {run.promptChanged ? 'new prompt' : 'same prompt'}
            </span>
          </th>
        ))}
        <th className={HEAD}>Fixed?</th>
      </tr>
    </thead>
  );
}

export function CaseHistory({
  dashboard,
  history,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
}): React.JSX.Element | null {
  const [opened, setOpened] = useState<Opened>({ kind: 'none' });
  if (history.runs.length < 2) return null;
  const fixed = history.cases.filter((one) => one.fixedIn !== null).length;
  return (
    <section className="mt-4">
      <h3 className="text-sm font-semibold">How it got fixed</h3>
      <p className="text-xs text-ink-muted">
        Each case across the recent runs, oldest on the left. {fixed} case(s) failed before and pass
        now. Click ✓ or ✗ for that conversation, or &quot;before / after&quot; to compare.
      </p>
      <ol className="mt-2 flex flex-col gap-2">
        {history.runs.map((run) => (
          <ChangeLine key={run.id} run={run} />
        ))}
      </ol>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <HeadRow runs={history.runs} />
          <tbody>
            {history.cases.map((evalCase) => (
              <CaseRow
                key={evalCase.scenarioId}
                history={history}
                evalCase={evalCase}
                onOpen={setOpened}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Opened dashboard={dashboard} history={history} opened={opened} />
    </section>
  );
}
