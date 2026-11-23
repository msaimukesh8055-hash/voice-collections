// web/src/features/health/AgentTargets.tsx
// Agent health's targets (Saim, 2026-11-23; moved here from Ops, which is now the shared machine
// only): one top line ("✓ All agents fine" or what needs a look), each voice agent's tools against
// the one 1 s target, and WhatsApp's reply time against "95% within 5 s". Agent health only
// summarises; one call's tools are on that call's page.
import type { AgentHealth, HealthSummary } from '../../lib/healthSchemas.ts';
import { TONE_CLASSES } from '../ops/opsFormat.ts';

const CELL = 'px-2 py-1.5';
const HEAD = `${CELL} text-left text-xs font-medium uppercase tracking-wide text-ink-muted`;
const NAMES: Readonly<Record<AgentHealth['agent'], string>> = {
  asha: 'Asha',
  munshi: 'Munshi',
  whatsapp: 'WhatsApp',
};

/** "8.7 s", "5 s", "1 s". */
function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))} s`;
}

/** Tools whose 95% time is over the target. */
export function slowTools(health: AgentHealth): AgentHealth['tools'] {
  return health.tools.filter((tool) => tool.p95Ms > health.toolTargetMs);
}

export function whatsappSlow(health: AgentHealth): boolean {
  return health.replyP95Ms !== null && health.replyP95Ms > health.replyTargetMs;
}

/** What needs a look on one agent, in a few words each; empty when it is fine. */
export function agentIssues(health: AgentHealth): string[] {
  const name = NAMES[health.agent];
  const issues: string[] = [];
  if (health.guardrailFails > 0) {
    issues.push(`${name}: ${health.guardrailFails} with a guardrail fail`);
  }
  if (health.agent === 'whatsapp' && whatsappSlow(health)) {
    const p95 = seconds(health.replyP95Ms ?? 0);
    issues.push(`WhatsApp replies slow (${p95}, target ${seconds(health.replyTargetMs)})`);
  }
  const slow = slowTools(health).length;
  if (slow > 0) issues.push(`${name}: ${slow} tool${slow === 1 ? '' : 's'} over 1 s`);
  return issues;
}

export function TopLine({ summary }: { readonly summary: HealthSummary }): React.JSX.Element {
  const issues = summary.agents.flatMap(agentIssues);
  return (
    <p
      className={`rounded-2xl bg-surface/95 px-5 py-3 text-lg font-semibold shadow-sm ring-1 ring-border ${
        TONE_CLASSES[issues.length === 0 ? 'good' : 'warn']
      }`}
    >
      {issues.length === 0 ? '✓ All agents fine' : `⚠ ${issues.join(' · ')}`}
    </p>
  );
}

export function ToolSpeeds({ health }: { readonly health: AgentHealth }): React.JSX.Element {
  const target = health.toolTargetMs;
  return (
    <section>
      <h3 className="text-sm font-semibold">Tools · 7 days</h3>
      <p className="mb-2 text-xs text-ink-muted">
        Target: every tool answers within {seconds(target)} for 95% of its calls (server time).
      </p>
      {health.tools.length === 0 ? (
        <p className="text-sm text-ink-muted">No tool calls in the last 7 days.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={HEAD}>Tool</th>
              <th className={HEAD}>Calls</th>
              <th className={HEAD}>Typical</th>
              <th className={HEAD}>95% within</th>
            </tr>
          </thead>
          <tbody>
            {health.tools.map((tool) => (
              <tr key={tool.tool} className="border-t border-border">
                <td className={`${CELL} font-mono text-xs`}>{tool.tool}</td>
                <td className={CELL}>{tool.calls}</td>
                <td className={CELL}>{tool.p50Ms} ms</td>
                <td
                  className={`${CELL} font-medium ${TONE_CLASSES[tool.p95Ms > target ? 'bad' : 'good']}`}
                >
                  {tool.p95Ms} ms {tool.p95Ms > target ? '· over' : '✓'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
