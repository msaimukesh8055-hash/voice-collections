# ADR-0005: Verify-before-disclose enforced in code

## Status
Accepted

## Context
RBI fair-practice expectations forbid sharing loan details with anyone but the verified borrower. An LLM can be talked into skipping a prompt instruction.

## Decision
- The call's `verified` flag is set only by `verify_customer` (server-side), per call.
- `lookup_loan`, `log_promise_to_pay` and `send_payment_link` **refuse** with `NOT_VERIFIED` until it is true.
- The customer is identified from Vapi call metadata, never from LLM-provided arguments.
- The prompt also instructs verification first (defence in depth).

## Alternatives considered
1) Prompt-only instruction (fails under jailbreaks or confusion)
2) Verification inside Vapi flow config (logic outside our tests and audit)

## Consequences
- A guarantee we can prove with tests at 100% coverage and in the audit trail.
- Slightly more tool round-trips per call.
- Same pattern reused for any future use case that discloses personal data.
