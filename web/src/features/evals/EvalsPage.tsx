// web/src/features/evals/EvalsPage.tsx
// /evals (M9 Build C4): does the AI still behave? For Asha (judged by Sarvam Tests plus our own
// database checks) and the WhatsApp brain (code checks): the release gate, the latest run case
// by case with the judge's reason for every failure, and the recent runs as a trend. Read-only;
// all names and amounts on this page are fake eval data. 2026-11-22: "How it got fixed" under
// each target (CaseHistory.tsx): every case across runs, what changed, and before / after.
// 2026-11-23 (golden outcomes): each case shows its expected outcome; opening one shows the test,
// expected vs this run row by row, and the conversation (CaseDetail.tsx).
// 2026-11-23 (model choice): under the brain, the model bake-off table (ModelChoice.tsx).
// 2026-11-23 (section menu): each agent, the model choice and live failures fold, with a menu.
import type { TestDraft } from '../../lib/testDraftSchemas.ts';
import type { DashboardApi } from '../../lib/dashboardApi.ts';
import { useState } from 'react';
import type { EvalCase, EvalRun, Evals, EvalTarget, GoldenCase } from '../../lib/evalsSchemas.ts';
import { dateTime } from '../dashboard/format.ts';
import { Card, Layout, LoadState } from '../dashboard/Layout.tsx';
import { type PageSection, Sections } from '../dashboard/Sections.tsx';
import { useLoad } from '../dashboard/useLoad.ts';
import { TONE_CLASSES } from '../ops/opsFormat.ts';
import { CaseDetail } from './CaseDetail.tsx';
import { CaseHistory } from './CaseHistory.tsx';
import { ModelChoice } from './ModelChoice.tsx';

const TARGETS: Readonly<Record<string, { title: string; how: string; agent: string }>> = {
  asha: {
    agent: 'Asha',
    title: 'Asha · reminder calls',
    how: 'Simulated callers and judge: Sarvam Tests. Tools and money: checked in our database.',
  },
  brain: {
    agent: 'Brain',
    title: 'WhatsApp brain · understanding messages',
    how: 'Each message must become the right command. Checked in code, no judge.',
  },
  munshi: {
    agent: 'Munshi',
    title: 'Munshi · the owner’s clerk',
    how: 'Simulated owner and judge: Sarvam Tests. Saves, sends and reminders: checked in our database.',
  },
};
const LIVE_TITLE = 'From live use';
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

interface CaseRowProps {
  readonly evalCase: EvalCase;
  readonly golden: GoldenCase | undefined;
  readonly agent: string;
  readonly opened: boolean;
  readonly onToggle: (caseId: string) => void;
}

function CaseRow({ evalCase, golden, agent, opened, onToggle }: CaseRowProps): React.JSX.Element {
  function toggle(): void {
    onToggle(evalCase.scenarioId);
  }
  return (
    <>
      <tr className="border-t border-border">
        <td className={`${CELL} font-mono text-xs`}>{evalCase.scenarioId}</td>
        <td className={CELL}>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={opened}
            className="text-left text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {golden?.name ?? (evalCase.scores.name || evalCase.scenarioId)}
          </button>
        </td>
        <td className={CELL}>{golden?.outcome ?? '—'}</td>
        <td className={`${CELL} font-medium ${TONE_CLASSES[evalCase.pass ? 'good' : 'bad']}`}>
          {evalCase.pass ? 'Pass' : 'Fail'}
          {evalCase.ranAlone ? (
            <span className="block text-xs font-normal text-ink-muted">
              New case, run on its own {dateTime(evalCase.ranAlone.createdAt)}; not in this gate
            </span>
          ) : null}
        </td>
      </tr>
      {opened ? (
        <tr>
          <td colSpan={4} className={CELL}>
            <CaseDetail golden={golden} evalCase={evalCase} agent={agent} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CaseTable({
  target,
  agent,
}: {
  readonly target: EvalTarget;
  readonly agent: string;
}): React.JSX.Element {
  const [opened, setOpened] = useState<string | null>(null);
  function toggle(caseId: string): void {
    setOpened((current) => (current === caseId ? null : caseId));
  }
  return (
    <table className="mt-1 w-full text-sm">
      <thead>
        <tr>
          <th className={HEAD}>Case</th>
          <th className={HEAD}>What was tested (open for details)</th>
          <th className={HEAD}>Expected outcome</th>
          <th className={HEAD}>Result</th>
        </tr>
      </thead>
      <tbody>
        {target.cases.map((evalCase) => (
          <CaseRow
            key={evalCase.scenarioId}
            evalCase={evalCase}
            golden={target.golden.find((one) => one.id === evalCase.scenarioId)}
            agent={agent}
            opened={opened === evalCase.scenarioId}
            onToggle={toggle}
          />
        ))}
      </tbody>
    </table>
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
          {run.metrics.only ? ` · only ${run.metrics.only}` : ''}
        </li>
      ))}
    </ul>
  );
}

function Target({
  target,
  dashboard,
}: {
  readonly target: EvalTarget;
  readonly dashboard: Pick<DashboardApi, 'evalCase'>;
}): React.JSX.Element {
  const about = TARGETS[target.target] ?? { title: target.target, how: '', agent: 'Agent' };
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
      <CaseTable target={target} agent={about.agent} />
      <CaseHistory dashboard={dashboard} history={target.caseHistory} agent={about.agent} />
    </Card>
  );
}

function NoRuns(): React.JSX.Element {
  return (
    <Card title="Evals">
      <p className="text-sm text-ink-muted">
        No eval run is stored yet. Run <span className="font-mono">npm run evals:asha</span> or{' '}
        <span className="font-mono">npm run evals:brain</span>.
      </p>
    </Card>
  );
}

/** Section menu (2026-11-23): one section per agent, the model choice, then live failures. */
function evalSections(evals: Evals, dashboard: DashboardApi): PageSection[] {
  const targets = evals.targets.flatMap((target): PageSection[] => {
    const about = TARGETS[target.target];
    const section: PageSection = {
      id: target.target,
      title: about?.title ?? target.target,
      badge: target.latest.metrics.passed ? '✅' : '❌',
      content: <Target target={target} dashboard={dashboard} />,
    };
    if (target.target !== 'brain') return [section];
    const models: PageSection = {
      id: 'model-choice',
      title: 'Model choice',
      content: <ModelChoice runs={evals.modelChoice} />,
    };
    return [section, models];
  });
  const live: PageSection = {
    id: 'live',
    title: LIVE_TITLE,
    content: <LiveDrafts dashboard={dashboard} />,
  };
  return [...targets, live];
}

function Summary({
  evals,
  dashboard,
}: {
  readonly evals: Evals;
  readonly dashboard: DashboardApi;
}): React.JSX.Element {
  const note = (
    <p className="text-xs text-ink-muted">
      As of {dateTime(evals.generatedAt)}. Every shopkeeper, shop and amount on this page is fake
      eval data, kept apart from the owner&apos;s book.
    </p>
  );
  return (
    <>
      {evals.targets.length === 0 ? <NoRuns /> : null}
      <Sections sections={evalSections(evals, dashboard)} />
      {note}
    </>
  );
}

const SOURCE_NAMES: Readonly<Record<TestDraft['source'], string>> = {
  asha_call: 'Asha call',
  munshi_call: 'Munshi call',
  whatsapp: 'WhatsApp message',
  whatsapp_chat: 'WhatsApp chat',
};

function draftHref(draft: TestDraft): string {
  const page = {
    asha_call: '/calls',
    munshi_call: '/munshi-calls',
    whatsapp: '/ops',
    whatsapp_chat: '/whatsapp',
  }[draft.source];
  return `${page}?id=${encodeURIComponent(draft.refId)}`;
}

function DraftList({ drafts }: { readonly drafts: readonly TestDraft[] }): React.JSX.Element {
  if (drafts.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing waiting. Use &quot;Add as a test case&quot; on a call report or a WhatsApp trace.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {drafts.map((draft) => (
        <li key={draft.id} className="rounded-xl bg-canvas p-3 ring-1 ring-border">
          <p className="flex flex-wrap justify-between gap-2">
            <a href={draftHref(draft)} className="font-medium text-brand underline">
              {SOURCE_NAMES[draft.source]} · {dateTime(draft.createdAt)}
            </a>
            <span className="text-xs text-ink-muted">{draft.status}</span>
          </p>
          <p className="mt-1">&ldquo;{draft.said}&rdquo;</p>
          <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">{draft.problem}</p>
          {draft.expected ? <p className="mt-1 text-xs">Should: {draft.expected}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Live failures waiting to become scripted tests (Saim, 2026-11-20). */
function LiveDrafts({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.testDrafts, 'test-drafts');
  const waiting =
    state.kind === 'ready' ? state.data.filter((one) => one.status === 'waiting') : [];
  return (
    <Card title={LIVE_TITLE}>
      <p className="mb-3 text-sm text-ink-muted">
        <span className="font-medium text-ink">{waiting.length} waiting.</span> Calls and WhatsApp
        messages that went wrong. Each becomes a scripted test once its wording is approved, then
        runs in the release gate every time.
      </p>
      <LoadState state={state}>
        {(drafts: readonly TestDraft[]) => <DraftList drafts={drafts} />}
      </LoadState>
    </Card>
  );
}

export function EvalsPage({ dashboard }: { readonly dashboard: DashboardApi }): React.JSX.Element {
  const state = useLoad(dashboard.evals, 'evals');
  return (
    <Layout current="/evals" dashboard={dashboard}>
      <LoadState state={state}>
        {(evals: Evals) => <Summary evals={evals} dashboard={dashboard} />}
      </LoadState>
    </Layout>
  );
}
