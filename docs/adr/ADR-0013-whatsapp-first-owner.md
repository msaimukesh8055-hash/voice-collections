# ADR-0013: WhatsApp is the owner's main interface

## Status
Accepted (SPEC v2.0, 2026-11-02). Recorded in M3; built in M4.

## Context
Srinivas Reddy runs a wholesale shop. He lives in WhatsApp, not in web dashboards. Recording credit, seeing who owes what and asking for a reminder call has to work from his phone in a few taps or a voice note, in Telugu or English.

## Decision
- The owner uses a **WhatsApp bot** (Meta Cloud API test number): ledger questions, add credit by text or voice note, mark paid, due alerts with a per-person **Remind** button, insights, voice replies.
- Remind goes through the same `queueCall()` as the demo Ring button, so the pre-call rules can't be skipped.
- The web dashboard is secondary: demo controls, call history, evals, release gate (M6).
- Writes from WhatsApp that change money (add credit, mark paid) need an explicit confirm step (M4 `pending_actions`).

## Alternatives considered
1) Dashboard-first: familiar to build, but not how a small trader works.
2) Telegram bot: easier API, but not what Indian traders use.

## Consequences
- Meta's test number limits who can message the bot (fine for a demo); production needs a verified business number.
- The webhook must verify Meta's signature and reply within seconds; slow work (speech-to-text, LLM) must stay inside that budget or reply later.
- No real phone numbers in the seed: the owner's number comes from `.env` in M4.
