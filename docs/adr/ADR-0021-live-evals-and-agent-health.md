# ADR-0021: Live calls are scored once and kept; failures become test drafts; evals run on server time

## Status
Accepted (2026-11-20, built at Saim's request: "Agent health", "live failures to tests", tone judge). Recorded at CP3. Builds on M9 (evals, release gate, ops).

## Context
The release gate tests scripted cases. Real calls (Saim's, and later the trader's) find problems the cases miss, such as the owner asking "who has paid?" first thing. We wanted every live call judged the same way as an eval, trends per prompt version, and a short path from a bad call to a new gate case, without paying to re-score every call each time a page opens.

## Decision
- **Scorecards in code, kept.** Each Asha call and Munshi owner call gets its scorecard (guardrails, outcome, flow, speed, cost) the first time its report opens; the result is saved in `call_scores` (one row per call, updated when re-scored). The Agent health page reads those rows (last 50 calls per agent, 14-day trend).
- **Tone by an AI judge, once, warnings only.** Gemini rates tone once per call; the result is kept on the call (`tone_judgement`) and can warn but never fails a call. Judge prompt v1 is a draft for Saim.
- **Transcripts kept for owner calls** (`owner_calls.transcript`, `transcript_en`), like Asha's.
- **Live failures → `test_drafts`.** "Add as a test case" on a call report or a WhatsApp trace saves a draft, listed on Evals as "From live use". It joins the gate only after Saim approves its wording.
- **Eval runners use server time.** Owner-call tokens are checked by the database clock, so both Sarvam gate runners read the server's time (one PC was 4 minutes behind); the Munshi runner also keeps each case's call clock fresh on a 15 s timer while Sarvam queues the run.
- **A case Sarvam never judged fails the gate** (CP3 E-H1).

## Alternatives considered
1) Score on every page open: simple but repeats the tone judge's cost and gives no history.
2) Save live failures straight into the gate: fast, but a case's wording is a product decision, so it waits for Saim.
3) An LLM judge for every check: slower and non-repeatable; only tone, which code cannot judge well, uses one.

## Consequences
- Four additive migrations (`20261120000001`–`04`), service role only.
- Open (CP3 S-M2): with `DASHBOARD_PUBLIC` on, `POST /v1/dashboard/test-drafts` is writable by anyone and has no rate limit; backlog item 17.
- Open (CP3 B-L3): the "Inside calling hours" check uses the real clock, not the demo clock at call time; backlog item 21.
