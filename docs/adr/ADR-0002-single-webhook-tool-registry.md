# ADR-0002: Single webhook with a typed tool registry

## Status
Accepted

## Context
Vapi sends tool calls and end-of-call reports to a server URL. We need consistent auth, validation and auditing for every tool across use cases.

## Decision
- One Edge Function, `vapi-webhook`, receives all Vapi messages.
- It verifies the Vapi secret, then dispatches by message type and tool name through a **typed lookup map** (no switch ladders).
- Every tool validates arguments with Zod and writes a `tool_events` audit row.
- Dashboard data uses a separate REST function (`calls-api`, `/v1/...`).

## Alternatives considered
1) One Edge Function per tool (duplicated auth/validation/audit; more deploys)
2) Vapi-hosted functions / no-code tools (logic outside our tests and audit trail)

## Consequences
- Auth, validation and audit are written once and tested at 100%.
- Adding a use case means registering tools, not new endpoints.
- Risk: a single point of failure — mitigated by keeping handlers small and fully tested.
