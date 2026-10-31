# M1 Plan — Voice Spike (English + Hindi)

**Branch:** `feature/M1-voice-spike` · **Time box:** 45 min · **Status:** awaiting approval (STOP 1)

## Goal

Prove the voice stack works before building anything on top of it: a real browser call to a Vapi assistant in **English** and **Hindi/Hinglish**, with interruptions handled and latency measured. No tools, no database, no real collections logic yet — a short "hello, I'm the Suvidha assistant" conversation.

This is a **spike**: its main output is evidence (what works, what doesn't, which settings to use), recorded in an ADR.

## Acceptance criteria (from SPEC M1)

- 1-minute call works in English and in Hindi from the browser
- Interrupting the agent mid-sentence makes it stop and listen
- Latency measured and recorded
- Gemini-as-agent-model question answered (works / doesn't / fallback used)
- Findings and chosen settings recorded in ADR-0007

## Decisions

### Decision 1: How the agent uses Gemini
🔍 **Ambiguity:** Vapi's docs don't clearly confirm a built-in Gemini option with our own key.
📊 **Options analysed:**
  (a) Vapi's built-in Google provider with our Gemini key saved as a Vapi credential — simplest if supported
  (b) Gemini's OpenAI-compatible endpoint via Vapi's "custom LLM" option — documented route, works with any compatible model
  (c) Vapi's own default model — works for sure, but every call spends free credit on the model too
✅ **My decision:** try (a) → if it fails, (b) → only then (c).
📐 **Reasoning:** (a) and (b) keep model cost on the free Gemini tier, so Vapi credit only pays for voice minutes. Whichever works is recorded in ADR-0004 (moves from Proposed to Accepted).
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

### Decision 2: One assistant for both languages, or two
🔍 **Ambiguity:** English and Hindi need different speech recognition and voice settings.
📊 **Options analysed:**
  (a) Two assistants (`collections-en`, `collections-hi`) generated from one config — clear, but two things to publish and keep in sync
  (b) One assistant; language-specific speech settings and greeting applied when the call starts — one thing to publish
✅ **My decision:** (b)
📐 **Reasoning:** one config, one publish, one eval target later. The customer's preferred language is known before the call starts, so the browser passes the right settings. If Vapi rejects the per-call settings, fall back to (a).
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

### Decision 3: Which speech providers to test for Hindi
🔍 **Ambiguity:** Hindi and Hinglish (mixed) quality differs by provider.
📊 **Options analysed:**
  - **Speech-to-text:** Deepgram Nova-3 (multilingual — better for Hinglish mixing) vs Azure `hi-IN` (pure Hindi)
  - **Voice:** Azure Indian neural voices — `en-IN` (Indian English) and `hi-IN` (Hindi) — natural accents, low cost
✅ **My decision:** test **both** speech-to-text options in Hindi with the same script; keep Azure Indian voices; pick the winner by evidence.
📐 **Reasoning:** Hinglish is how real borrowers talk; choosing by test result, not by assumption, is the point of a spike.
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

## Files to create

```
agent/collections/assistant.config.ts   typed assistant config (model, voice, transcriber per language, greeting, interruption settings)
agent/collections/language-settings.ts  EN/HI speech + greeting settings
agent/schema.ts                         Zod schema for agent configs (validated before publishing)
scripts/agent-push.ts                   creates/updates the assistant on Vapi via its API (private key, server-side only)
agent/collections/vapi-assistant.json   the Vapi assistant id after first push (not secret)
web/src/features/voice-spike/VoiceSpikePage.tsx   bare test page: language picker, Start / Stop call, live status + transcript
web/src/lib/vapiClient.ts               thin wrapper around @vapi-ai/web (injectable for tests)
docs/reports/M1-voice-spike.md          test results (filled in during the smoke test)
docs/adr/ADR-0007-voice-stack.md        chosen transcriber, voice, model route, interruption settings
```

`agent:push` here is a plain push. The **release gate** (evals must pass first) wraps it in M6.

## Env vars introduced

| Variable | Where it's used | Secret? |
|---|---|---|
| `VAPI_PRIVATE_KEY` | `scripts/agent-push.ts` only | **Yes** — never in the browser |
| `VITE_VAPI_PUBLIC_KEY` | browser (starting web calls) | No — designed to be public |
| `GEMINI_API_KEY` | saved to Vapi as a credential by the push script | **Yes** |

## Test list

| Test | Type | TDD | 100% |
|---|---|---|---|
| Agent config passes its Zod schema; invalid config (missing greeting, unknown language) is rejected | Unit | ✅ | ✅ (validation) |
| Each language has a greeting that includes **AI disclosure + recording notice** | Unit | ✅ | ✅ (compliance) |
| Language settings map EN → Indian-English voice, HI → Hindi voice + chosen transcriber | Unit | ✅ | — |
| Push payload never contains the Gemini or Vapi private key in plain fields it shouldn't | Unit | ✅ | ✅ (security) |
| Push script: creates when no id saved, updates when id exists (fake HTTP client) | Unit | ✅ | — |
| Spike page: Start calls the client with the chosen language; Stop ends the call; errors shown, not thrown | Unit (RTL, fake client) | — | — |
| **Build check:** production bundle contains no private key value | Gate script | — | — |

## Smoke test (you + me, real voice — about 6–8 minutes of Vapi credit)

| # | Test | What we look for |
|---|---|---|
| 1 | English call, ~1 min | Clear greeting with AI disclosure; natural replies |
| 2 | Hindi call, ~1 min (Deepgram) | Understands Hindi; replies in Hindi |
| 3 | Hindi call, ~1 min (Azure) | Same script, compare accuracy |
| 4 | Hinglish: mix English and Hindi in one sentence | Understood correctly |
| 5 | Interrupt the agent mid-sentence | It stops within ~1 s and listens |
| 6 | Stay silent | It prompts once, then closes politely |

I'll measure response times from Vapi's call logs. You judge naturalness — your ear decides the voice.

## What I need from you before building

1. **Vapi** account (no card): public key + private key (Vapi dashboard → Org / API Keys)
2. **Gemini** key from aistudio.google.com (no billing account)
3. I'll add the empty lines to `.env`; you paste the values (not in chat)
4. Say **"go ahead"** (or override a decision)

## Risks

| Risk | Mitigation |
|---|---|
| Gemini not usable via Vapi | Decision 1 fallback chain; recorded in ADR |
| Hindi recognition poor on both providers | Try a third option (Google STT) before giving up; record evidence |
| Free credit drains during testing | Smoke test capped at ~8 minutes; I'll report credit used |
| Microphone permission / browser issues | Test in Chrome or Edge; the in-app browser pane can't use your mic, so you'll open the page in your normal browser |
