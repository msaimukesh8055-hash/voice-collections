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

## Amendment (M3, 2026-11-02): identity confirmation replaces DOB
Shopkeepers are known to the owner; asking a date of birth would be odd. The rule stays, the check changes:
- Asha asks "Am I speaking with Ramesh garu of Ramesh Kirana?" and calls `confirm_identity` with `confirmed`, `denied` or `unsure`. The answer is stored on the call row with a compare-and-set.
- `get_dues`, `log_promise`, `record_payment_claim` refuse (no figures in the reply) until it is `confirmed`. `denied` locks the call; two `unsure` answers count as `denied`.
- The greeting names the business and the person but no amount, so a wrong person hears nothing about the dues.
- Trade-off: weaker than a secret (anyone saying "yes" is believed). Acceptable for a known-customer trade-credit reminder with fake data; a lender would add a stronger check.
