# ADR-0009: The server knows who is on a call from a one-time call token

## Status
Accepted (M2, 2026-11-01; M2 Decision 1). Recorded at CP1 (2026-11-02). Builds on ADR-0005.

## Context
Tools such as `lookup_loan` must act for exactly one borrower. The LLM must never be the one that says who that is: a confused or manipulated model could ask for another customer's loan. Browser calls have no caller phone number to go on.

## Decision
- The dashboard asks `calls-api` `POST /v1/calls/authorize` for a call. The pre-call rules run there (do-not-call, calling hours, attempt limits, rate limit), and a `calls` row is created. Its id is the **call token** (a random UUID).
- The browser starts the Vapi call with the token in `assistantOverrides.metadata`. No tool schema has a customer field.
- On the first tool call, `vapi-webhook` locks the token to that Vapi call id with a conditional update (`vapi_call_id is null`), so exactly one call can win. The token must be claimed within 10 minutes; a second Vapi call using it is refused.
- Every tool then runs for the customer on that `calls` row. Verification state lives on the same row.

## Alternatives considered
1) Customer id in call metadata: anyone who can start a Vapi call could name any customer.
2) Customer id as a tool argument: the LLM decides who the customer is, which breaks ADR-0005.
3) Signed tokens (JWT): no database lookup, but they can't be locked to one call or revoked without extra state.

## Consequences
- Identity never comes from model output, and a token can't be replayed on a second call.
- The token is only as protected as `calls-api`: it needs just the public anon key (prototype, M2 Decision 5). A per-customer rate limit and a daily cap on failed DOB attempts limit abuse (CP1 M1, M2). Real phone lines would add caller-ID matching and staff login.
- Every call costs one database row, even if never used. Old unclaimed tokens simply expire.

## Amendment (M3, 2026-11-02): lock by call state, not by interaction id
Sarvam sends no interaction id to tools (spike check 2), so the first-tool-call lock can't work. The token is now created by `queueCall()` (demo Ring, later WhatsApp Remind) and locked by the call's state:
- The phone page must **accept** a `ringing` call (compare-and-set) before anything else.
- The Sarvam proxy issues **one call URL per token**, only within 2 minutes of accept (→ `in_progress`). One token can start at most one Sarvam session.
- Tools work only while the call is `accepted`/`in_progress` and within **10 minutes** of accept. After `…/ended` (→ `completed`), `declined` or `missed`, tools refuse.
- The token reaches tools as the `call_token` agent variable (not sent to the LLM, never spoken). The interaction id is stored from the browser at hang-up (never overwriting one already stored) and from the Analytics API in M5.
