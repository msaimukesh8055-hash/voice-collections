# ADR-0012: Sarvam Voice Agents replace Vapi

## Status
Accepted (M3, 2026-11-02; SPEC v2.0, spike GO). Supersedes ADR-0001 and ADR-0007.

## Context
The pitch moved to Sarvam AI (SPEC v2.0): Telugu-first credit recovery for a small trader in Anantapur. Vapi had no good Telugu voice or speech-to-text and ran in the US. Sarvam has Telugu, Hindi and English speech (Saaras, Bulbul), hosted voice agents with API tools, and a browser SDK (`sarvam-conv-ai-sdk`).

## Decision
- Asha runs on **Sarvam Voice Agents**, browser calls only (no phone numbers).
- **Key proxy:** the SDK's one HTTP request (`…/apps/{app}/url`) goes to our `calls-api`, which adds `SARVAM_AGENTS_API_KEY` server-side and passes Sarvam's signed URL back. The browser sends `apiKey: ''`.
- **Tools:** 5 Sarvam API tools POST `{call_token, …LLM args}` to `sarvam-tools` with a bearer secret kept in Sarvam's vault (`easy-recovery-tool-secret`). Replies are `{ok, say, …data}` with response template `{{say}}`; HTTP 200 except auth failures.
- **Config as code:** `voice-agents/asha/` (prompt, greetings, voice, languages, tools generated from the server's Zod schemas). `npm run agent:build` renders JSON; it is pushed with the Sarvam MCP connector (Sarvam has no public config API). `npm run agent:record` ties a committed version to the config hash in `publishes`.
- SDK pinned to exactly `0.0.42` (pre-1.0).

## Alternatives considered
1) Keep Vapi with a Telugu speech provider: weak Telugu, US latency, wrong pitch.
2) Sarvam speech APIs + our own WebSocket agent loop: more control, much more to build and test in 8 hours.
3) Give the browser a Sarvam key: simplest, but leaks a billable key.

## Consequences
- Telugu voice and a platform in India (Azure India); tool calls stay in-country with Mumbai functions (ADR-0008).
- Sarvam sends no interaction id to tools, so the token is locked by call state (ADR-0009 amendment). The interaction id comes from the browser at hang-up, and from the Analytics API in M5.
- Tool auth must be attached by hand in Sarvam's console (the MCP connector refuses secrets).
- A pre-1.0 SDK can change shape: pinned, wrapped behind `VoiceClient` (`web/src/lib/sarvamClient.ts`) so only one adapter file touches it.
