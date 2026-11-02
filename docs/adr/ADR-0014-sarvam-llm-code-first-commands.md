# ADR-0014: Sarvam LLM as the brain; fixed commands parsed in code first

## Status
Accepted (SPEC v2.0, 2026-11-02). Recorded in M3; used from M4.

## Context
The WhatsApp bot, follow-up agent and simulated calls need an LLM. Most owner messages are short and predictable ("Ramesh 5000 credit", "Latha paid 2000", "who owes me?"). An LLM on every message adds cost, latency and a chance of the wrong amount.

## Decision
- **Code first:** fixed commands (add credit, mark paid, balance, list dues, remind) are parsed with plain rules. Amounts and names are taken from the text, never invented.
- **LLM second:** only messages the rules can't parse go to Sarvam `sarvam-105b`, which must answer in a strict JSON shape (Zod-validated) or the bot asks the owner to rephrase.
- Follow-ups: rules decide clear cases; the LLM only decides judgement calls and its output is validated before any action (ADR-0006).
- Gemini (free tier) is the eval judge and a fallback when Sarvam is unavailable (ADR-0004).

## Alternatives considered
1) LLM for everything: simpler code, but slower and riskier on money.
2) Gemini as the brain: works, but weakens the Sarvam pitch.

## Consequences
- Most messages answer instantly and deterministically, and are unit-tested.
- The LLM path needs evals (M7) and a clear "didn't understand" reply.
- Two providers to configure (Sarvam, Gemini); keys stay server-side.
