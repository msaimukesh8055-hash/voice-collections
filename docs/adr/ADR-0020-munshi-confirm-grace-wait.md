# ADR-0020: Munshi's confirm survives a tool fired beside it (grace wait, plain "not saved", claim match)

## Status
Accepted (2026-11-20, Saim approved both fix plans after gate runs 3 and 4). Builds on ADR-0018 (two-step confirm in code). Recorded at CP3.

## Context
Sarvam's LLM can call two tools in one turn, and there is no setting to stop it. Gate runs 3 and 4 showed Munshi sending `confirm_action` together with the next `prepare_*` (the new read-back cancelled the open change, so nothing was saved) or together with `end_interaction` (Sarvam drops a tool sent with the hang-up). Both times the owner heard "done" with nothing saved. Prompt lines alone (v3) did not stop it.

## Decision
- **Grace wait.** A `prepare_*` that would replace an open change which could already be confirmed (older than the 2 s lock) first waits `REPLACE_GRACE_MS` = 1.5 s, so a confirm sent in the same turn saves first. A real correction still replaces the change after the wait.
- **Dated after the wait.** The new change is stamped with a fresh clock read after the wait (`OwnerToolContext.clock`), so the 2 s "no yes yet" lock still counts from when it was read back (CP3 S-H1).
- **Say plainly when nothing was saved.** A confirm whose change was replaced gets `REPLACED_NOT_SAVED`, never "already done".
- **A payment that matches an open claim accepts the claim** (same shopkeeper, same amount) instead of saving a second payment.
- **Every read-back reply ends with the confirm-alone line** ("confirm_action on its own, not even ending the call"); Munshi prompt v3 says the same.

## Alternatives considered
1) Prompt only: tried in v3; the model still fired two tools at once.
2) Refuse any prepare while a change is open: blocks a real correction ("no, 3,000"), which the owner does often.
3) Queue tool calls per owner call in the database: right in theory, but needs a migration and a lock table for a problem the wait solves.

## Consequences
- A correction's read-back is 1.5 s slower; nothing else is.
- Gate run 5 on Munshi v3 passed 16/16 (eval run d3070d7a).
- Platform feedback for Sarvam: a tool sent together with `end_interaction` is silently dropped, and parallel tool calls cannot be turned off.
- Open (CP3 S-M1): a confirm whose write times out is reopened; without an idempotency key a second "yes" could save twice. Needs a migration; backlog item 16.
