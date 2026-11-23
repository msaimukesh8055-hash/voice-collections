// web/src/features/evals/CaseDetail.tsx
// One eval case opened (Saim, 2026-11-23), in order: (a) the test, the simulated caller's script
// or the owner's message; (b) expected vs this run, row by row: who checks it (our code or the AI
// judge), whether it blocks the release, ✓ or ✗ and why; (c) the conversation, with "Asha" or
// "Munshi" and "Simulated caller" instead of assistant / user. All of it is fake eval data.
import type { EvalCase, GoldenCase } from '../../lib/evalsSchemas.ts';
import { TONE_CLASSES } from '../ops/opsFormat.ts';
import {
  type BrainRow,
  brainRows,
  type ResultRow,
  resultRows,
  type RowStatus,
  turnsOf,
} from './expectedRows.ts';

const CELL = 'px-2 py-1.5 align-top';
const HEAD = `${CELL} text-left text-xs font-medium text-ink-muted`;
const CHECKED_BY: Readonly<Record<ResultRow['checkedBy'], string>> = {
  code: 'Code',
  judge: 'AI judge',
};

export function Mark({ status }: { readonly status: RowStatus }): React.JSX.Element {
  if (status === 'not_checked') {
    return <span className="text-xs text-ink-muted">Not checked in this run</span>;
  }
  const passed = status === 'pass';
  return (
    <span
      aria-label={passed ? 'passed' : 'failed'}
      className={`font-semibold ${TONE_CLASSES[passed ? 'good' : 'bad']}`}
    >
      {passed ? '✓' : '✗'}
    </span>
  );
}

function Blocker({ blocker }: { readonly blocker: boolean }): React.JSX.Element {
  return blocker ? (
    <span aria-label="release blocker">🔒</span>
  ) : (
    <span className="text-ink-muted">—</span>
  );
}

function TheTest({ golden }: { readonly golden: GoldenCase }): React.JSX.Element {
  const isMessage = golden.command !== null;
  return (
    <section aria-label="The test">
      <h4 className="text-sm font-semibold">
        {isMessage ? 'The test: what the owner sends' : 'The test: the simulated caller’s script'}
      </h4>
      <p className="mt-1 rounded-lg bg-canvas p-2 text-sm ring-1 ring-border">{golden.test}</p>
      {golden.meaning ? (
        <p className="mt-1 text-xs text-ink-muted">Meaning: {golden.meaning}</p>
      ) : null}
    </section>
  );
}

function ExpectedTable({ rows }: { readonly rows: readonly ResultRow[] }): React.JSX.Element {
  return (
    <table className="mt-1 w-full text-sm">
      <thead>
        <tr>
          <th className={HEAD}>Expected</th>
          <th className={HEAD}>Checked by</th>
          <th className={HEAD}>🔒 Release blocker</th>
          <th className={HEAD}>This run</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.checkedBy}:${row.label}`} className="border-t border-border">
            <td className={CELL}>
              <span className="font-medium">{row.label}</span>
              <span className="block text-xs text-ink-muted">{row.expected}</span>
            </td>
            <td className={CELL}>{CHECKED_BY[row.checkedBy]}</td>
            <td className={CELL}>
              <Blocker blocker={row.blocker} />
            </td>
            <td className={CELL}>
              <Mark status={row.status} />
              {row.note ? (
                <span
                  className={`block text-xs ${row.status === 'fail' ? 'text-danger' : 'text-ink-muted'}`}
                >
                  {row.note}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BrainTable({
  rows,
  money,
}: {
  readonly rows: readonly BrainRow[];
  readonly money: boolean;
}): React.JSX.Element {
  return (
    <table className="mt-1 w-full text-sm">
      <thead>
        <tr>
          <th className={HEAD}>Part</th>
          <th className={HEAD}>Expected</th>
          <th className={HEAD}>Got</th>
          <th className={HEAD}>Checked by</th>
          <th className={HEAD}>🔒 Release blocker</th>
          <th className={HEAD}>This run</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-border">
            <td className={`${CELL} font-medium`}>{row.label}</td>
            <td className={`${CELL} font-mono text-xs`}>{row.expected}</td>
            <td className={`${CELL} font-mono text-xs`}>{row.got}</td>
            <td className={CELL}>Code</td>
            <td className={CELL}>
              <Blocker blocker={money} />
            </td>
            <td className={CELL}>
              <Mark status={row.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Transcript({
  transcript,
  agent,
}: {
  readonly transcript: string;
  readonly agent: string;
}): React.JSX.Element {
  const turns = turnsOf(transcript, agent);
  return (
    <ol className="mt-1 flex max-h-96 flex-col gap-1.5 overflow-auto rounded-lg bg-brand-soft p-2 text-xs text-ink">
      {turns.map((turn, index) => (
        <li key={index} className="whitespace-pre-wrap break-words">
          <span className={`font-semibold ${turn.fromAgent ? 'text-brand' : ''}`}>
            {turn.speaker}:
          </span>{' '}
          {turn.text}
        </li>
      ))}
    </ol>
  );
}

function Results({
  golden,
  evalCase,
}: {
  readonly golden: GoldenCase;
  readonly evalCase: EvalCase;
}): React.JSX.Element {
  if (golden.command !== null) {
    return <BrainTable rows={brainRows(golden, evalCase)} money={golden.money} />;
  }
  return (
    <>
      <ExpectedTable rows={resultRows(golden, evalCase)} />
      <p className="mt-1 text-xs text-ink-muted">
        🔒 One failure blocks the release on its own. Judged behaviours without 🔒 count together:
        90% of them must pass across the run.
      </p>
    </>
  );
}

export function CaseDetail({
  golden,
  evalCase,
  agent,
}: {
  readonly golden: GoldenCase | undefined;
  readonly evalCase: EvalCase;
  readonly agent: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-2">
      {golden ? <TheTest golden={golden} /> : null}
      <section aria-label="Expected vs this run">
        <h4 className="text-sm font-semibold">Expected vs this run</h4>
        {golden ? (
          <Results golden={golden} evalCase={evalCase} />
        ) : (
          <p className="text-sm text-ink-muted">This case is not in today’s case list.</p>
        )}
      </section>
      <section aria-label="The conversation">
        <h4 className="text-sm font-semibold">The conversation</h4>
        <Transcript transcript={evalCase.transcript} agent={agent} />
      </section>
    </div>
  );
}
