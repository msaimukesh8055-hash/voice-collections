# ADR-0010: Edge Functions talk to the database through a small HTTP client, not supabase-js

## Status
Accepted (M2 voice-test fixes, 2026-11-02). Recorded at CP1.

## Context
The M2 voice test measured 2.2–2.7 s per tool call. Part of that was the function starting up cold (about 2 s, even with no database work), and the function running in Mumbai rather than next to the database in Oregon. supabase-js brings auth, realtime and storage code the functions never use, all of which loads on every cold start.

## Decision
- `_shared/db/postgrest.ts`: a fetch-based client for Supabase's database HTTP API (PostgREST). It sends the service key, has a 5 s timeout per request, and turns failures into `RepositoryError("<operation> failed (<code>)")`. Database messages are dropped because they can quote row values.
- `_shared/db/supabase-repository.ts` builds the `Repository` on that client. Every row read is still parsed with Zod.
- Conditional writes use PostgREST filters: claiming a call (`vapi_call_id=is.null`), recording a DOB attempt (`verify_attempts=eq.<previous>`).
- Calls are pinned to Oregon with the `x-region` header (ADR-0008).
- Scripts (`check-seed`) may still use supabase-js; only the functions avoid it.

## Alternatives considered
1) Keep supabase-js: less of our own code, but heavier cold starts on the call path.
2) A direct Postgres driver: needs connection pooling, which Edge Functions handle poorly.

## Consequences
- Tool round trip went to about 0.5 s measured from India (smoke test), and lower from Vapi in Oregon.
- We own about 80 lines of client code. It is unit-tested with a fake fetch (exact URLs, headers, error mapping).
- Aggregates are done in code (e.g. summing failed attempts), since PostgREST aggregates are off by default.
