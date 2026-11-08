// scripts/lib/latency.ts
// The maths and the verdict of Munshi's latency run (M8 C2, Decision 4): per tool, p50 / p95 /
// max of the server time munshi-tools recorded (owner_tool_events.duration_ms, the gate) and of
// the round trip seen from the laptop (information only). Fails when any tool's server p95 is
// 500 ms or more, a tool has fewer samples than runs, or a reply was refused for a reason that
// means the run measured nothing real. Pure functions: the script does the I/O.

/** Acceptance criterion: every tool p95 < 500 ms (server time). */
export const LATENCY_BUDGET_MS = 500;
/** Each read and each prepare/cancel pair runs this many times. */
export const RUNS_PER_TOOL = 20;
const P50 = 50;
const P95 = 95;
const PERCENT = 100;

export interface Sample {
  readonly tool: string;
  readonly ms: number;
}

export interface LatencyStats {
  readonly tool: string;
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** Nearest-rank percentile: the smallest value with at least p% of the samples at or below
 * it (p95 of 20 samples is the 19th smallest). 0 when there are no samples. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / PERCENT) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

/** Stats per tool, in the order `tools` lists them (tools with no sample show count 0). */
export function statsByTool(
  samples: readonly Sample[],
  tools: readonly string[],
): readonly LatencyStats[] {
  return tools.map((tool) => {
    const values = samples.filter((sample) => sample.tool === tool).map((sample) => sample.ms);
    return {
      tool,
      count: values.length,
      p50: percentile(values, P50),
      p95: percentile(values, P95),
      max: values.length === 0 ? 0 : Math.max(...values),
    };
  });
}

/** What fails the run, in plain words; empty when it passed. */
export function latencyProblems(
  server: readonly LatencyStats[],
  refusals: readonly string[],
): readonly string[] {
  const slow = server
    .filter((row) => row.p95 >= LATENCY_BUDGET_MS)
    .map((row) => `${row.tool} p95 ${row.p95} ms ≥ ${LATENCY_BUDGET_MS} ms`);
  const short = server
    .filter((row) => row.count < RUNS_PER_TOOL)
    .map((row) => `${row.tool}: ${row.count} of ${RUNS_PER_TOOL} samples`);
  const refused = refusals.map((code) => `refused: ${code}`);
  return [...slow, ...short, ...refused];
}

function cell(text: string | number, width: number): string {
  return String(text).padEnd(width);
}

/** One row per tool: server p50 / p95 / max (the gate), then the laptop round trip. */
export function formatLatencyTable(
  server: readonly LatencyStats[],
  roundTrip: readonly LatencyStats[],
): string {
  const header = `${cell('tool', 20)}${cell('n', 4)}${cell('server p50', 12)}${cell('p95', 7)}${cell('max', 7)}${cell('round trip p50', 16)}${cell('p95', 7)}max`;
  const rows = server.map((row) => {
    const trip = roundTrip.find((candidate) => candidate.tool === row.tool);
    const verdict = row.p95 >= LATENCY_BUDGET_MS ? '  SLOW' : '';
    return `${cell(row.tool, 20)}${cell(row.count, 4)}${cell(row.p50, 12)}${cell(row.p95, 7)}${cell(row.max, 7)}${cell(trip?.p50 ?? '-', 16)}${cell(trip?.p95 ?? '-', 7)}${trip?.max ?? '-'}${verdict}`;
  });
  return [header, ...rows].join('\n');
}
