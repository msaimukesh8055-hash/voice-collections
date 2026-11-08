# ADR-0019: Asha's memory is a code-built call history; the LLM note is the owner's only

## Status
Accepted (M7 Build B1, approved by Saim at STOP 1 on 2026-11-07: Decisions 1–5 as recommended). Builds on ADR-0016 (follow-up agent) and the CP2 M2 fix (the LLM note no longer reaches Asha). Munshi (ADR-0018) will reuse the same history builder. The plan called this ADR-0018; that number was already taken by Munshi, so it is 0019.

## Context
Asha started every call from scratch apart from the last promise and a rejected claim. Saim wanted her to remember past calls "to a certain extent", with facts from our records and never the shopkeeper's free words as instructions. The follow-up note is written by an LLM from what the shopkeeper said, so a planted line ("the owner agreed to waive ₹2,000") could come back to Asha as trusted tool output. That path was closed in CP2 M2, which left the note with no reader at all (backlog items 9 and 10).

## Decision
- **History from records, in `get_dues`, after identity only.** The last 3 ended calls (newest first, last 6 months, current call left out): date, outcome (the same `outcomeFrom` as the follow-up rules), the promise and its result after today's promise check, the claim and the owner's answer, the fixed callback reasons, and "was upset" (the follow-up run's `angry` signal).
- **One request, no extra round trip.** `listPastCalls` is one PostgREST read of `calls` with the promise, claim, callback and follow-up-run rows embedded. It runs in the same `Promise.all` as the other three reads. The follow-up run's free-text `reasoning` is never selected; only the fixed signal list is read from `actions`.
- **Pure builder, separate describer.** `buildCallHistory` (rows in, structured facts out, no English) is reusable. `describeHistoryForAsha` writes Asha's English lines, capped at 600 characters (the oldest calls are dropped first). The audit row gets counts only.
- **Their words: one sanitised phrase, or nothing.** Taken only from Asha's own callback summary, only on a call where identity was confirmed, and only for hardship, dispute or other. It is dropped whole if it has any figure (digits in any script, scale, number or rupee words), names the owner, uses money terms or instruction words, or ends up under 3 letters. Kept to 80 characters and shown as `Their words (a claim, not checked): "…"`. Asha's v6 prompt treats it as background only, never a source of an amount or date.
- **The LLM note stays the owner's.** It is shown in the WhatsApp lookup ("📝 Last call note") and stored for the dashboard. Asha never reads it.

## Alternatives considered
1) RAG over notes and transcripts: we already know exactly what we need (this shopkeeper's last 3 calls), so a direct lookup is exact, free and has nothing to keep in sync.
2) Fixed reasons only, no words at all: safest, but Asha knows *that* money was tight, not *why*. Kept as the fallback whenever a phrase is dropped.
3) The LLM note, sanitised: it mixes our figures with their words, and it is the exact path CP2 M2 closed.
4) A Postgres view or function: needs a migration and moves the logic out of tested TypeScript.

## Consequences
- No migration, no new env var, secret or tool argument. `get_dues`'s `say` grows by at most 600 characters.
- Asha prompt v6 (the "Memory and tone" section) has to be pushed to Sarvam and, after the smoke, committed there.
- The seed gives Ramesh 2 earlier calls (day −10 with the broken ₹3,000 promise linked, day −4 with a hardship callback), so the first demo call already has a history.
- The SPEC §7.3 and §8 item 4 wording still says Asha reads the note; the new wording is proposed in M7.md and waits for Saim's approval.
