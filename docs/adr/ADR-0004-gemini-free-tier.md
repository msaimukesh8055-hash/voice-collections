# ADR-0004: Gemini free tier for AI steps, embeddings and evals

## Status
Accepted, amended by [ADR-0007](ADR-0007-voice-stack.md) (2026-11-01): the **live voice agent** uses Vapi-hosted `gpt-4.1-mini`. In the M1 smoke test Gemini's free tier was overloaded or out of quota, and the one working model took 3–5 s to start replying. Everything else below still holds.

## Context
The budget is ₹0. The project needs an LLM for the live agent, post-call AI steps, the follow-up agent's judgement, embeddings for RAG, and eval simulation/judging.

## Decision
- Use Google Gemini (free tier, AI Studio key, no billing account).
- ~~Live agent: Gemini via Vapi with our own key~~ → superseded by ADR-0007 (Vapi-hosted GPT; Gemini via Vapi was tested and failed on latency/availability).
- All Gemini calls are server-side; the key never reaches the browser.

## Alternatives considered
1) OpenAI / Anthropic APIs (paid from the first call)
2) Open-source model self-hosted (hosting cost + setup time)

## Consequences
- ₹0 for evals and AI steps; rate limits require throttling in the eval runner.
- Free-tier data may be used by Google to improve products — acceptable only because all data is fake.
- Model choice is isolated behind one client module so it can be swapped.
