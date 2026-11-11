// web/src/features/evals/EvalsPage.tsx
// /evals (M9 Build C4): does the AI still behave? For Asha (judged by Sarvam Tests plus our own
// database checks) and the WhatsApp brain (code checks): the release gate, the latest run case
// by case with the judge's reason for every failure, and the recent runs as a trend. Read-only;
// all names and amounts on this page are fake eval data.
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import type { EvalCase, EvalRun, Evals, EvalTarget } from '../../lib/evalsSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

const TARGETS: Readonly<Record<string, { title: string; how: string }>> = {
  asha: {
    title: 'Asha · reminder calls',
    how: 'Simulated callers and judge: Sarvam Tests. Tools and money: checked in our database.',
  },
  brain: {
    title: 'WhatsApp brain · understanding messages',
    how: 'Each message must become the right command. Checked in code, no judge.',
  },
};
const CELL = 'px-2 py-1.5 align-top';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;

function Gate({ run }: { readonly run: EvalRun }): React.JSX.Element {
  const { passed, reasons } = run.metrics;
  return (
    <p className="text-sm">
      <span
        className={`rounded-full px-2 py-0.5 font-semibold ${
          passed ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
        }`}
      >
        {passed ? 'Release gate passed' : 'Release gate failed'}
      </span>
      {reasons.length > 0 ? (
        <span className="ml-2 text-ink-muted">{reasons.join('; ')}</span>
      ) : null}
    </p>
  );
}

function facts(run: EvalRun): string {
  const m = run.metrics;
  const parts = [
    `${m.casesPassed} of ${m.cases} cases passed`,
    m.behaviours === undefined ? null : `${m.behavioursPassed ?? 0} of ${m.behaviours} behaviours`,
    m.guardrailFailures === undefined ? null : `${m.guardrailFailures} guardrail failures`,
    m.criticalFailures === undefined ? null : `${m.criticalFailures} critical check failures`,
    m.moneyFailures === undefined ? null : `${m.moneyFailures} money cases wrong`,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

function version(run: EvalRun): string {
  const m = run.metrics;
  const parts = [
    m.promptVersion ? `prompt ${m.promptVersion}` : null,
    m.appVersion === undefined ? null : `agent version ${m.appVersion}`,
    `prompt hash ${run.promptHash}`,
  ];
  return parts.filter((part) => part !== null).join(' · ');
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

function CaseRow({ evalCase }: { readonly evalCase: EvalCase }): React.JSX.Element {
  const failed = failures(evalCase);
  return (
    <tr className="border-t border-border">
      <td className={`${CELL} font-mono text-xs`}>{evalCase.scenarioId}</td>
      <td className={CELL}>
        <details>
          <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-brand">
            {evalCase.scores.name || evalCase.scenarioId}
          </summary>
          {failed.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-danger">
              {failed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-brand-soft p-2 text-xs text-ink">
            {evalCase.transcript}
          </pre>
        </details>
      </td>
      <td className={`${CELL} font-medium ${TONE_CLASSES[evalCase.pass ? 'good' : 'bad']}`}>
        {evalCase.pass ? 'Pass' : 'Fail'}
      </td>
    </tr>
  );
}

function Trend({ history }: { readonly history: readonly EvalRun[] }): React.JSX.Element {
  return (
    <ul aria-label="Recent runs" className="mt-2 flex flex-wrap gap-1.5 text-xs">
      {history.map((run) => (
        <li
          key={run.id}
          className={`rounded-full px-2 py-0.5 ring-1 ring-border ${
            TONE_CLASSES[run.metrics.passed ? 'good' : 'bad']
          }`}
        >
          {dateTime(run.createdAt)} · {run.metrics.casesPassed}/{run.metrics.cases} ·{' '}
          {run.metrics.passed ? 'passed' : 'failed'}
        </li>
      ))}
    </ul>
  );
}

function Target({ target }: { readonly target: EvalTarget }): React.JSX.Element {
  const about = TARGETS[target.target] ?? { title: target.target, how: '' };
  const { latest } = target;
  return (
    <Card title={about.title}>
      <Gate run={latest} />
      <p className="mt-2 text-sm">{facts(latest)}</p>
      <p className="text-xs text-ink-muted">
        {dateTime(latest.createdAt)} · {version(latest)}
      </p>
      {about.how ? <p className="mt-1 text-xs text-ink-muted">{about.how}</p> : null}
      <h3 className="mt-4 text-sm font-semibold">Recent runs</h3>
      <Trend history={target.history} />
      <h3 className="mt-4 text-sm font-semibold">Latest run, case by case</h3>
      <table className="mt-1 w-full text-sm">
        <thead>
          <tr>
            <th className={HEAD}>Case</th>
            <th className={HEAD}>What was tested (open for the conversation)</th>
            <th className={HEAD}>Result</th>
          </tr>
        </thead>
        <tbody>
          {target.cases.map((evalCase) => (
            <CaseRow key={evalCase.scenarioId} evalCase={evalCase} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Summary({ evals }: { readonly evals: Evals }): React.JSX.Element {
  if (evals.targets.length === 0) {
    return (
      <Card title="Evals">
        <p className="text-sm text-ink-muted">
          No eval run is stored yet. Run <span className="font-mono">npm run evals:asha</span> or{' '}
          <span className="font-mono">npm run evals:brain</span>.
        </p>
      </Card>
    );
  }
  return (
    <>
      {evals.targets.map((target) => (
        <Target key={target.target} target={target} />
      ))}
      <p className="text-xs text-ink-muted">
        As of {dateTime(evals.generatedAt)}. Every shopkeeper, shop and amount on this page is fake
        eval data, kept apart from the owner&apos;s book.
      </p>
    </>
  );
}

export function EvalsPage({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.evals, 'evals');
  return (
    <Layout current="/evals" dashboard={dashboard}>
      <LoadState state={state}>{(evals: Evals) => <Summary evals={evals} />}</LoadState>
    </Layout>
  );
}
