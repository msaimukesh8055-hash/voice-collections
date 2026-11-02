# ADR-0003: Supabase cloud only, no local Docker stack

## Status
Accepted

## Context
Supabase's local stack requires Docker, which is not installed. The build window is ~8 hours.

## Decision
- Use the free cloud Supabase project (Postgres + pgvector + Edge Functions) directly.
- Migrations and seed are applied with `npm run db:push`; `npm run db:check-seed` verifies them.
- Unit tests never touch a database — they use injected fakes (testing.md).
- Prototype region: ~~EU (Ireland)~~ **US West (Oregon)**, next to Vapi, from M2 ([ADR-0008](ADR-0008-server-region-next-to-vapi.md)).
- Edge Functions share one import map (`supabase/functions/deno.json`, wired in `supabase/config.toml`) and are deployed with `npm run functions:deploy` (server-side bundling, no Docker).

## Alternatives considered
1) Install Docker Desktop for a local stack (several GB, ~30+ min setup)
2) A different DB host (loses pgvector + Edge Functions in one place)

## Consequences
- Fast start; one environment to reason about.
- No disposable local DB for integration tests; seed is the reference state.
- Production for an Indian NBFC would need data stored in India (RBI data localisation, DPDP) and separate dev/prod projects; see ADR-0008 for why that also means an India-hosted voice platform.
