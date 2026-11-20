// supabase/functions/_shared/calls/agent-health.ts
// Agent health (Saim, 2026-11-20): how Asha and Munshi are doing across calls, not one call at a
// time. Each call's scorecard is kept as a CallScore when its report is worked out; this file turns
// the kept scores into one agent's health: verdicts, the checks that go wrong most, guardrail
// fails, reply time, cost, tone, a daily trend and the same numbers per prompt version (matched
// from when each version was published). Pure code, no AI, ₹0.
import { istDate } from '../clock.ts';
import type { CheckStatus, Scorecard, Verdict } from './scorecard.ts';

export type HealthAgent = 'asha' | 'munshi';

export interface ScoredCheck {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly status: CheckStatus;
}

export interface CallScore {
  readonly agent: HealthAgent;
  readonly callId: string;
  readonly startedAt: string;
  readonly verdict: Verdict;
  readonly passed: number;
  readonly applicable: number;
  readonly checks: readonly ScoredCheck[];
  /** Tone point id → 1–5, from the AI judge; empty when not judged. */
  readonly tone: Readonly<Record<string, number>>;
  readonly costInr: number | null;
  readonly replyP50Ms: number | null;
}

export interface Publish {
  readonly agent: HealthAgent;
  readonly version: number;
  readonly publishedAt: string;
}

export interface Problem {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly fails: number;
  readonly warns: number;
  /** The calls it happened on, newest first. */
  readonly callIds: readonly string[];
}

export interface VerdictCounts {
  readonly good: number;
  readonly check: number;
  readonly failed: number;
}

export interface VersionHealth extends VerdictCounts {
  /** Sarvam version live when the call started; null when it is not known. */
  readonly version: number | null;
  readonly calls: number;
}

export interface DayHealth extends VerdictCounts {
  readonly date: string;
}

export interface TonePoint {
  readonly id: string;
  readonly label: string;
  readonly average: number;
  readonly calls: number;
}

export interface AgentHealth {
  readonly agent: HealthAgent;
  readonly calls: number;
  readonly verdicts: VerdictCounts;
  readonly problems: readonly Problem[];
  /** Calls where at least one guardrail failed. */
  readonly guardrailFails: number;
  /** Middle of the calls' typical reply times; null when none was measured. */
  readonly replyP50Ms: number | null;
  readonly averageCostInr: number | null;
  readonly tone: readonly TonePoint[];
  readonly versions: readonly VersionHealth[];
  readonly trend: readonly DayHealth[];
}

export const HEALTH_CALLS = 50;
export const TREND_DAYS = 14;
const TOP_PROBLEMS = 8;
const TOOL_USE_GROUP = 'Tools needed';
const TONE_GROUP = 'Tone';

/** One call's scorecard as kept for the health page. */
export function toCallScore(
  input: Omit<CallScore, 'verdict' | 'passed' | 'applicable' | 'checks'>,
  card: Scorecard,
): CallScore {
  const checks: ScoredCheck[] = [
    ...card.groups.flatMap((group) =>
      group.checks.map((one) => ({
        id: one.id,
        label: one.label,
        group: group.name,
        status: one.status,
      }))
    ),
    ...card.toolUse.map((row) => ({
      id: `tool_use_${row.tool}`,
      label: `${row.tool} needed but never ran`,
      group: TOOL_USE_GROUP,
      status: row.status,
    })),
  ];
  return {
    ...input,
    verdict: card.verdict,
    passed: card.passed,
    applicable: card.applicable,
    checks,
  };
}

function countVerdicts(scores: readonly CallScore[]): VerdictCounts {
  return {
    good: scores.filter((score) => score.verdict === 'good').length,
    check: scores.filter((score) => score.verdict === 'check').length,
    failed: scores.filter((score) => score.verdict === 'failed').length,
  };
}

function problems(scores: readonly CallScore[]): Problem[] {
  const found = new Map<string, Problem>();
  for (const score of scores) {
    for (const one of score.checks) {
      if (one.status !== 'fail' && one.status !== 'warn') continue;
      const before = found.get(one.id);
      found.set(one.id, {
        id: one.id,
        label: one.label,
        group: one.group,
        fails: (before?.fails ?? 0) + (one.status === 'fail' ? 1 : 0),
        warns: (before?.warns ?? 0) + (one.status === 'warn' ? 1 : 0),
        callIds: [...(before?.callIds ?? []), score.callId],
      });
    }
  }
  return [...found.values()]
    .sort((a, b) => b.fails - a.fails || b.warns - a.warns || a.label.localeCompare(b.label))
    .slice(0, TOP_PROBLEMS);
}

function middle(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const upper = sorted[half] ?? 0;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[half - 1] ?? 0) + upper) / 2);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function tonePoints(scores: readonly CallScore[]): TonePoint[] {
  const labels = new Map<string, string>();
  for (const score of scores) {
    for (const one of score.checks) {
      if (one.group === TONE_GROUP) labels.set(one.id.replace(/^tone_/, ''), one.label);
    }
  }
  return [...labels].flatMap(([id, label]) => {
    const given = scores.map((score) => score.tone[id]).filter((value) => value !== undefined);
    const mean = average(given);
    return mean === null ? [] : [{ id, label, average: mean, calls: given.length }];
  });
}

/** The version live when the call started: the newest publish at or before it. */
export function versionAt(
  publishes: readonly Publish[],
  agent: HealthAgent,
  at: string,
): number | null {
  const live = publishes
    .filter((one) => one.agent === agent && one.publishedAt <= at)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return live[0]?.version ?? null;
}

function versions(
  scores: readonly CallScore[],
  publishes: readonly Publish[],
  agent: HealthAgent,
): VersionHealth[] {
  const groups = new Map<number | null, CallScore[]>();
  for (const score of scores) {
    const version = versionAt(publishes, agent, new Date(score.startedAt).toISOString());
    groups.set(version, [...(groups.get(version) ?? []), score]);
  }
  return [...groups]
    .map(([version, calls]) => ({ version, calls: calls.length, ...countVerdicts(calls) }))
    .sort((a, b) => (b.version ?? -1) - (a.version ?? -1));
}

function trend(scores: readonly CallScore[], today: string): DayHealth[] {
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: TREND_DAYS }, (_, back) => {
    const date = new Date(start - (TREND_DAYS - 1 - back) * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      ...countVerdicts(scores.filter((score) => istDate(new Date(score.startedAt)) === date)),
    };
  });
}

/** One agent's health from its kept scores (newest first), on the demo-clock date. */
export interface HealthInput {
  /** Kept scores, newest first; other agents' are left out. */
  readonly scores: readonly CallScore[];
  readonly publishes: readonly Publish[];
  readonly today: string;
}

export function agentHealth(
  agent: HealthAgent,
  { scores: all, publishes, today }: HealthInput,
): AgentHealth {
  const scores = all.filter((score) => score.agent === agent).slice(0, HEALTH_CALLS);
  const costs = scores.flatMap((score) => score.costInr === null ? [] : [score.costInr]);
  const replies = scores.flatMap((score) => score.replyP50Ms === null ? [] : [score.replyP50Ms]);
  return {
    agent,
    calls: scores.length,
    verdicts: countVerdicts(scores),
    problems: problems(scores),
    guardrailFails:
      scores.filter((score) =>
        score.checks.some((one) => one.group === 'Guardrails' && one.status === 'fail')
      ).length,
    replyP50Ms: middle(replies),
    averageCostInr: average(costs),
    tone: tonePoints(scores),
    versions: versions(scores, publishes, agent),
    trend: trend(scores, today),
  };
}
