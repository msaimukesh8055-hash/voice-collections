// web/src/features/evals/CaseHistory.tsx
// "How it got fixed" (Saim, 2026-11-22): every case across the recent runs, oldest on the left,
// a "what changed" line for each run, and for a case that failed and now passes, a before / after
// view: the last failing conversation, what changed, and the passing one. Whether the prompt
// changed comes from the prompt hash; the note is written per run (run-notes.ts).
// 2026-11-23: shown as the prompt-version table (one column per run, its prompt version on top).
// The separate "How it got fixed" list is gone: what changed, the fix note, the prompt lines and
// the case's story live in the Before / after panel opened from the Fixed column.
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
import { Transcript } from './CaseDetail.tsx';

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

/** "Broke on prompt v7, fixed on prompt v8 (Prompt changed)." or, on one prompt,
 * "Failed, then fixed on the same prompt v2 (Test setup or checks fixed)." */
function fixLine(before: HistoryRun, after: HistoryRun, broke: boolean): string {
  const how = CHANGE_LABELS[after.change];
  if (before.promptName && before.promptName === after.promptName) {
    return `${broke ? 'Broke' : 'Failed'}, then fixed on the same prompt ${after.promptName} (${how}).`;
  }
  return `${broke ? 'Broke' : 'Failed'} on ${stepName(before)}, fixed on ${stepName(after)} (${how}).`;
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

interface ConversationProps {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly runId: string;
  readonly caseId: string;
  readonly title: string;
  readonly agent: string;
}

function Conversation({
  dashboard,
  runId,
  caseId,
  title,
  agent,
}: ConversationProps): React.JSX.Element {
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
              <Transcript transcript={evalCase.transcript} agent={agent} />
            </>
          );
        }}
      </LoadState>
    </div>
  );
}

function PromptLines({ run }: { readonly run: HistoryRun }): React.JSX.Element | null {
  const change = run.promptChange;
  if (!change) return null;
  return (
    <details className="mt-2 rounded-lg bg-canvas p-2 text-xs ring-1 ring-border">
      <summary className="cursor-pointer font-medium">
        Prompt lines changed from {change.from} to {run.promptName} ({change.added.length} added,{' '}
        {change.removed.length} taken out)
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {change.removed.map((line) => (
          <li key={`-${line}`} className="rounded bg-danger/10 p-1 text-danger">
            − {line}
          </li>
        ))}
        {change.added.map((line) => (
          <li key={`+${line}`} className="rounded bg-success/10 p-1 text-success">
            + {line}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FixSummary({
  history,
  evalCase,
  before,
  after,
}: {
  readonly history: History;
  readonly evalCase: HistoryCase;
  readonly before: HistoryRun;
  readonly after: HistoryRun;
}): React.JSX.Element {
  return (
    <>
      <p className="mt-1 text-sm font-medium">{storyOf(history.runs, evalCase)}</p>
      <p className="mt-1 text-sm">
        {fixLine(before, after, brokeThenFixed(history.runs, evalCase))}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Before: {shortRun(before)}, {before.casesPassed}/{before.cases} cases. After:{' '}
        {shortRun(after)}, {after.casesPassed}/{after.cases} cases.
      </p>
      {evalCase.fixNote ? (
        <p className="mt-1 text-sm">
          <span className="font-medium">What fixed it: </span>
          {evalCase.fixNote}
        </p>
      ) : null}
      <PromptLines run={after} />
      <p className="mt-2 text-xs text-ink-muted">
        <span className="font-medium">Everything else in that run: </span>
        {after.note ?? 'No note written for this run.'}
      </p>
    </>
  );
}

function BeforeAfter({
  dashboard,
  history,
  evalCase,
  agent,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
  readonly evalCase: HistoryCase;
  readonly agent: string;
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
      <FixSummary history={history} evalCase={evalCase} before={before} after={after} />
      <div className="mt-3 flex flex-col gap-3 lg:flex-row">
        <Conversation
          dashboard={dashboard}
          runId={before.id}
          caseId={evalCase.scenarioId}
          title={`Before · ${stepName(before)} · ${shortRun(before)}`}
          agent={agent}
        />
        <Conversation
          dashboard={dashboard}
          runId={after.id}
          caseId={evalCase.scenarioId}
          title={`After · ${stepName(after)} · ${shortRun(after)}`}
          agent={agent}
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
  agent,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
  readonly opened: Opened;
  readonly agent: string;
}): React.JSX.Element | null {
  if (opened.kind === 'none') return null;
  if (opened.kind === 'compare') {
    const evalCase = history.cases.find((one) => one.scenarioId === opened.caseId);
    return evalCase ? (
      <BeforeAfter dashboard={dashboard} history={history} evalCase={evalCase} agent={agent} />
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
        title={`${opened.caseId} · ${stepName(run)} · ${shortRun(run)}`}
        agent={agent}
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
            <span className="block text-ink">
              {run.promptName ? `prompt ${run.promptName}` : '—'}
            </span>
            <span className="block font-normal">{shortRun(run)}</span>
            {run.release ? <span className="block font-normal">{run.release}</span> : null}
            <span className="block font-normal">{CHANGE_LABELS[run.change]}</span>
          </th>
        ))}
        <th className={HEAD}>Fixed? (before / after)</th>
      </tr>
    </thead>
  );
}

export function CaseHistory({
  dashboard,
  history,
  agent,
}: {
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
  readonly history: History;
  readonly agent: string;
}): React.JSX.Element | null {
  const [opened, setOpened] = useState<Opened>({ kind: 'none' });
  if (history.runs.length < 2) return null;
  const fixed = history.cases.filter((one) => one.fixedIn !== null).length;
  return (
    <section className="mt-4">
      <h3 className="text-sm font-semibold">Test results by prompt version</h3>
      <p className="text-xs text-ink-muted">
        Each case across the recent runs, oldest on the left. {fixed} case(s) failed before and pass
        now. Click ✓ or ✗ for that conversation, or &quot;before / after&quot; for what fixed it.
      </p>
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
      <Opened dashboard={dashboard} history={history} opened={opened} agent={agent} />
    </section>
  );
}
