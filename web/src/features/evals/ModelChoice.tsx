// web/src/features/evals/ModelChoice.tsx
// "Model choice" (Saim, 2026-11-23): the WhatsApp brain's eval messages, same prompt and same
// checker, through each model on its own. Read-only; the numbers are what evals:bakeoff stored.
// 2026-11-24 (Saim: "too clunky, make it simpler"): the answer first in one line ("✅ Using
// sarvam-105b. Most accurate…"), then one card per model with four big numbers (right answers,
// money mistakes, typical reply, cost per 1,000 messages) and "Safe on its own?" with the reason
// in words: each money mistake by its message, and whether our code reads that message before
// any model (then the owner never sees the mistake). A model whose numbers match another exactly
// as shown (Sarvam's chat variant) is one line, not a second card. How it was tested sits in a fold.
import type { ModelRun } from '../../lib/modelChoiceSchemas.ts';
import { dateTime, formatInr } from '../dashboard/format.ts';
import { Card } from '../dashboard/Layout.tsx';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

type Metrics = ModelRun['metrics'];

const MS_PER_SECOND = 1000;
/** Only say "N× faster" when the gap is worth saying. */
const FASTER_RATIO = 1.5;
const IN_USE = 'sarvam-105b';

/** What each model does in the product today (Saim's decision, 2026-11-23). */
const MODEL_ROLE: Readonly<Record<string, string>> = {
  'sarvam-105b': 'In use',
  'gemini-2.5-flash': 'Backup if Sarvam fails',
};

const GRID: Readonly<Record<number, string>> = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' };

function seconds(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(1)} s`;
}

function percentOf(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

function providerName(m: Metrics): string {
  return m.provider.charAt(0).toUpperCase() + m.provider.slice(1);
}

/** The same on every figure as the page shows it (typical reply to 0.1 s). */
function sameScores(a: Metrics, b: Metrics): boolean {
  return (
    a.cases === b.cases &&
    a.casesPassed === b.casesPassed &&
    a.moneyFailures === b.moneyFailures &&
    a.indicPassed === b.indicPassed &&
    a.failedCalls === b.failedCalls &&
    seconds(a.p50Ms) === seconds(b.p50Ms) &&
    a.costPer1000Inr === b.costPer1000Inr
  );
}

interface Split {
  readonly shown: readonly ModelRun[];
  /** A variant that scored exactly like a shown model: [variant, the model it matched]. */
  readonly twins: ReadonlyArray<readonly [ModelRun, ModelRun]>;
}

/** Shows each model once; a variant ("sarvam-105b-…") with identical numbers becomes a line. */
export function splitTwins(runs: readonly ModelRun[]): Split {
  const shown: ModelRun[] = [];
  const twins: Array<readonly [ModelRun, ModelRun]> = [];
  for (const run of runs) {
    const twin = shown.find(
      (one) =>
        run.metrics.model.startsWith(`${one.metrics.model}-`) &&
        sameScores(one.metrics, run.metrics),
    );
    if (twin) twins.push([run, twin]);
    else shown.push(run);
  }
  return { shown, twins };
}

/** The answer in one line: which model, and why, against the backup. */
export function headline(shown: readonly ModelRun[]): string {
  const main = shown.find((run) => run.metrics.model === IN_USE) ?? shown[0];
  if (!main) return '';
  const m = main.metrics;
  const backup = shown.find((run) => run.metrics.provider !== main.metrics.provider)?.metrics;
  const accuracy = percentOf(m.casesPassed, m.cases);
  const best = shown.every((run) => run.metrics.casesPassed <= m.casesPassed);
  const parts = [best ? `Most accurate (${accuracy})` : `${accuracy} right`];
  if (backup && m.p50Ms > 0 && backup.p50Ms / m.p50Ms >= FASTER_RATIO) {
    const times = Math.round(backup.p50Ms / m.p50Ms);
    parts.push(
      `${times}× faster than ${providerName(backup)} (${seconds(m.p50Ms)} vs ${seconds(backup.p50Ms)})`,
    );
  }
  parts.push(`${formatInr(m.costPer1000Inr)} per 1,000 messages`);
  const backupLine = backup
    ? ` ${providerName(backup)} is the backup if ${providerName(m)} fails.`
    : '';
  return `✅ Using ${m.model}. ${parts.join(', ')}.${backupLine}`;
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: 'good' | 'bad';
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-canvas p-3 ring-1 ring-border">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-2xl font-semibold ${tone ? TONE_CLASSES[tone] : ''}`}>{value}</p>
      {sub ? <p className="text-xs text-ink-muted">{sub}</p> : null}
    </div>
  );
}

/** Why a model is or is not safe on its own, one reason per line. */
export function safetyReasons(run: ModelRun): readonly string[] {
  const m = run.metrics;
  if (m.passed) return [];
  const reasons = run.moneyMisses.map(
    (miss) =>
      `Money mistake on “${miss.text}”. ${
        miss.codeAnswers
          ? 'In the live product our code reads this message before the AI sees it, so the owner never gets this mistake.'
          : 'Our code does not read this message first, so the owner would see this answer.'
      }`,
  );
  const unexplained = m.moneyFailures - run.moneyMisses.length;
  if (unexplained > 0) reasons.push(`${unexplained} money message(s) answered wrongly.`);
  if (m.failedCalls > 0) {
    const limit = m.provider === 'gemini' ? ' (free-tier limit)' : '';
    reasons.push(`${m.failedCalls} message(s) got no answer${limit}.`);
  }
  return reasons.length > 0 ? reasons : m.reasons;
}

function Safety({ run }: { readonly run: ModelRun }): React.JSX.Element {
  const reasons = safetyReasons(run);
  return (
    <div className="mt-3 text-sm">
      <p className="font-medium">
        Safe on its own?{' '}
        <span className={TONE_CLASSES[run.metrics.passed ? 'good' : 'bad']}>
          {run.metrics.passed ? 'Yes' : 'No'}
        </span>
      </p>
      {reasons.length > 0 ? (
        <ul className="mt-1 list-disc pl-5 text-ink-muted">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ModelCard({ run }: { readonly run: ModelRun }): React.JSX.Element {
  const m = run.metrics;
  const role = MODEL_ROLE[m.model];
  return (
    <article aria-label={m.model} className="rounded-2xl p-4 ring-1 ring-border">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-semibold">{m.model}</h3>
        {role ? (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
            {role}
          </span>
        ) : null}
      </header>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="Right answers"
          value={percentOf(m.casesPassed, m.cases)}
          sub={`${m.casesPassed} of ${m.cases}`}
        />
        <Stat
          label="Money mistakes"
          value={`${m.moneyFailures} of ${m.moneyCases}`}
          tone={m.moneyFailures === 0 ? 'good' : 'bad'}
        />
        <Stat label="Typical reply" value={seconds(m.p50Ms)} sub={`slowest ${seconds(m.maxMs)}`} />
        <Stat label="Per 1,000 messages" value={formatInr(m.costPer1000Inr)} />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Telugu / Hindi: {m.indicPassed} of {m.indicCases} right
      </p>
      <Safety run={run} />
    </article>
  );
}

function priceNotes(runs: readonly ModelRun[]): string {
  return [...new Set(runs.map((run) => run.metrics.priceNote).filter(Boolean))].join(' ');
}

function HowTested({
  runs,
  newest,
}: {
  readonly runs: readonly ModelRun[];
  readonly newest: ModelRun;
}): React.JSX.Element {
  return (
    <details className="mt-3 text-xs text-ink-muted">
      <summary className="cursor-pointer font-medium">How we tested</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Every WhatsApp brain eval message, same prompt and same checker, sent to each model on its
          own: no backup and no code reading the message first (in the product, code answers fixed
          commands before any model is asked). Run {dateTime(newest.createdAt)}.
        </li>
        <li>
          Right answers: messages turned into the right command, name and amount. Money mistakes:
          money messages answered wrongly (each one fails the gate on its own). A message with no
          answer counts as a miss, not as a money mistake.
        </li>
        <li>Typical reply is the middle time; slowest is the longest. Calls from this PC.</li>
        <li>
          Per 1,000 messages: average tokens per message × price, with 18% GST. {priceNotes(runs)}
        </li>
        <li>
          Decision (Saim, 23 Nov): sarvam-105b runs the WhatsApp brain; Gemini is only the backup
          when Sarvam fails.
        </li>
      </ul>
    </details>
  );
}

export function ModelChoice({
  runs,
}: {
  readonly runs: readonly ModelRun[];
}): React.JSX.Element | null {
  if (runs.length === 0) return null;
  const newest = runs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const { shown, twins } = splitTwins(runs);
  return (
    <Card title="Model choice">
      <p className="mb-3 text-base font-semibold">{headline(shown)}</p>
      <div className={`grid gap-4 ${GRID[shown.length] ?? ''}`}>
        {shown.map((run) => (
          <ModelCard key={run.id} run={run} />
        ))}
      </div>
      {twins.map(([twin, of]) => (
        <p key={twin.id} className="mt-2 text-sm text-ink-muted">
          {twin.metrics.model} scored the same as {of.metrics.model} (same answers, mistakes and
          cost; typical reply within 0.1 s), so it has no card of its own.
        </p>
      ))}
      <HowTested runs={runs} newest={newest} />
    </Card>
  );
}
