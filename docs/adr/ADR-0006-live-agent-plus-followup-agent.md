# ADR-0006: One live voice agent + a follow-up agent; rules before agent

## Status
Accepted

## Context
The JD asks for multi-agent workflows. Live voice is latency-sensitive; post-call decisions are not, and many of them are clear-cut.

## Decision
- **One** agent handles the live call (no in-call handovers).
- After the call, a **follow-up agent** takes over: deterministic **rules** decide clear cases first; the agent decides only judgement calls (hardship vs stalling, mixed signals).
- Follow-up tools are **guarded** (calling hours, attempt limits, policy windows) so the agent cannot break rules.
- Every run writes a customer note that the voice agent reads on the next call.
- Summary and compliance check are AI steps, not agents.

## Alternatives considered
1) Vapi Squads — multiple agents inside the live call (added latency, context loss; v2)
2) A fully rule-based follow-up (no judgement for ambiguous cases)
3) An LLM for every follow-up decision (overkill, less predictable, harder to audit)

## Consequences
- A genuine agent-to-agent handover with an auditable "rule or agent, and why" trail.
- Follow-up decisions are testable: rules at 100%, agent judgement via eval scenarios.
- Future: add in-call specialists via Squads if latency allows.
