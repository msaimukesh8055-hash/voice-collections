# ADR-0008: Database and functions in Oregon, next to Vapi

## Status
Accepted (M2, 2026-11-01). Amends ADR-0003 (region).

## Context
During a call, every tool call goes Vapi → our webhook → database → back to Vapi while the caller waits. Vapi's call servers run in **AWS us-west-2 (Oregon)** (from our M1 call records), and Vapi cannot be moved. Our first Supabase project was in eu-west-1 (Ireland), so every tool call crossed the Atlantic (~140 ms per round trip, several per tool).

## Decision
- New Supabase project `voice-collections-us` in **us-west-2 (Oregon)**: Postgres and Edge Functions sit in the same region as Vapi.
- Schema and seed re-applied with `npm run db:push`; seed check passed (9/9 tables, anon key blocked).
- The Ireland project is **paused**, not deleted (free plan allows two active projects; one belongs to another of Saim's projects). Deleting it is Saim's call.
- A tool does at most one read and one write (parallel where possible), so database distance is paid once.

## Alternatives considered
1) Stay in Ireland, webhook next to the database: one Atlantic crossing per tool call (~150–250 ms added)
2) Mumbai: worse for this prototype (~230 ms per crossing, because Vapi itself is in the US)

## Consequences
- Tool calls stay inside one cloud region (~20–60 ms network expected; measured in the M2 voice test).
- **Data residency trade-off (interview point):** a real Indian NBFC must keep borrower data in India (RBI data localisation, DPDP Act). Low latency *and* residency then needs a voice platform that also runs in India: either Vapi's enterprise data-residency option or an India-hosted voice stack. For this prototype, all data is fake, so Oregon is acceptable.
- Anyone running the repo needs an Oregon project to reproduce the latency numbers; any region works functionally.
