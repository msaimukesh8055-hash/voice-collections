# ADR-0004: Gemini free tier for agent, AI steps, embeddings and evals

## Status
Proposed (Vapi + own Gemini key to be confirmed in M1)

## Context
The budget is ₹0. The project needs an LLM for the live agent, post-call AI steps, the follow-up agent's judgement, embeddings for RAG, and eval simulation/judging.

## Decision
- Use Google Gemini (free tier, AI Studio key, no billing account).
- Live agent: Gemini via Vapi with our own key, if supported; otherwise Vapi's cheapest built-in model within free credit.
- All Gemini calls are server-side; the key never reaches the browser.

## Alternatives considered
1) OpenAI / Anthropic APIs (paid from the first call)
2) Open-source model self-hosted (hosting cost + setup time)

## Consequences
- ₹0 for evals and AI steps; rate limits require throttling in the eval runner.
- Free-tier data may be used by Google to improve products — acceptable only because all data is fake.
- Model choice is isolated behind one client module so it can be swapped.
