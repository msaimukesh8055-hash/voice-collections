# ADR-0007: Voice stack — Vapi-hosted GPT, Deepgram, Azure Indian voices

## Status
Accepted (M1 voice spike, 2026-11-01; chosen by Saim on smoke-test evidence)

## Context
M1 had to prove a real browser call works in English and Hindi/Hinglish, with interruptions and acceptable reply time (target: under 1.5 s from the caller stopping to the agent starting). The plan assumed the live agent's model would be Gemini on the free tier (ADR-0004), and left the Hindi speech-to-text provider to be chosen by test.

## Evidence (smoke test, 9 calls, 8.8 minutes, $0.65 of Vapi credit)

**Model.** With Gemini (`gemini-3.8-flash`, via Vapi's built-in Google provider and our key) the agent never replied: Google returned nothing within 20 s (`providerfault-model-no-response`) and the call ended on silence. Probing the Gemini API directly with our key:

| Model | Result |
|---|---|
| gemini-3.8-flash | 503 "high demand", then 429 free quota exceeded |
| gemini-3.1-flash-lite | 503 on most attempts; one request stalled ~4 min |
| gemini-2.5-flash | Works, but 2.6–4.5 s to first word (default "thinking"; Vapi has no setting to turn it off) |
| gemini-2.0-flash, 2.5-flash-lite | 404 (retired) |

**After switching to Vapi-hosted `gpt-4.1-mini`** (Vapi call metrics, average per call):

| Call | Reply time | Model | Speech-to-text | Voice | Waiting for end of speech |
|---|---|---|---|---|---|
| English (Deepgram `en`) | **1.15–1.27 s** ✅ | 0.30–0.41 s | 0.08–0.46 s | 0.23–0.36 s | 0.09–0.24 s |
| Hindi (Azure `hi-IN`, 1.5 s wait) | 2.41 s ❌ | 0.38 s | 0.33 s | 0.46 s | **1.22 s** |
| Hinglish (Deepgram `multi`, 0.8 s wait) | **1.26 s** ✅ | 0.42 s | 0.38 s | 0.25 s | 0.16 s |

**Hindi speech-to-text.** Deepgram `multi` writes each language in its own script ("Hey, मेरा नाम मुकेश है. I am doing pretty good."); Azure `hi-IN` forced English words into Devanagari and misheard some ("interrupt" → "interest"). Transcriber cost: Deepgram ≈ $0.01/min, Azure ≈ $0.035/min.

**Interruptions** worked in every call (3–6 per call). **Silence:** idle prompt once, then the call ends on its own.

## Decision
- **Live agent model: `gpt-4.1-mini`, hosted by Vapi** (`provider: openai`, no key of ours; billed to Vapi credit, ≈ $0.002 per minute). Non-reasoning model, so replies start fast. Vapi picks backup models automatically if it fails.
- **Speech-to-text: Deepgram Nova-3** for both languages — `en` for English, `multi` for Hindi (handles Hinglish).
- **Voices: Azure Indian neural voices** — `en-IN-NeerjaNeural`, `hi-IN-SwaraNeural`.
- **One assistant**, language applied per call (transcriber, voice, fixed lines, end-of-speech wait) — plan Decision 2(b) confirmed working.
- **End-of-speech wait** (Vapi `onNoPunctuationSeconds`): English 1.5 s (Vapi default), Hindi **0.8 s** (Saim's choice — Hindi transcripts often lack punctuation, so the full wait applied on every turn).
- **Interruption:** stop when the caller speaks for 0.2 s (`numWords 0`), resume after 1 s. Kept fast on purpose; revisit in M3 if background noise or "haan" backchannels cut the agent off too often.
- **Call cap:** 4 minutes per call, including on demo day (Saim's choice; credit guard). Was 2 minutes in M1; raised in M2 (2026-11-02) because a full call takes 2.5–3 minutes. 16 test calls cost $1.34 in total.

## Alternatives considered
1) **Gemini 2.5 Flash via Vapi** — ₹0 and works, but 3–5 s of silence before each reply; unusable for a live demo.
2) **Our own Gemini proxy** (Edge Function as Vapi "custom LLM", thinking turned off) — ₹0 and ~1–1.5 s when Google is up, but the free tier was returning 503s, and it adds ~1 h of build plus a network hop.
3) **Azure `hi-IN` for Hindi** — fine on pure Hindi, weaker on Hinglish, ~3× the cost.

## Consequences
- Spend moves from ₹0 to a few rupees per demo for the model; well inside the ₹1,000 cap and covered by Vapi's free credit (no card).
- Gemini stays the model for everything that isn't real-time (summary, compliance check, follow-up judgement, embeddings, eval simulator and judge) — ADR-0004 amended.
- Evals (M6) must run the agent prompt against `gpt-4.1-mini` behaviour to be meaningful, while the judge stays on Gemini; noted for the M6 plan.
- The Gemini key is no longer stored on Vapi by the push script (the credential created earlier still exists in the Vapi account; safe to delete there).
- Model choice stays one line in `voice-agents/collections/assistant.config.ts`, validated by `voice-agents/schema.ts`.

## SDK issues found and handled (in `web/src/lib/vapiClient.ts`)
- The Vapi Web SDK is CommonJS; the dev server hands back `{ default: Vapi }` instead of the class → resolved both shapes.
- The SDK's `removeAllListeners()` forwards an undefined event name, so it removes nothing → in React StrictMode the first subscription stayed attached and every transcript line appeared twice. Listeners are now removed one by one.
- When the server ends a call, the SDK reports Daily's "Meeting has ended" as an error → treated as a normal hang-up.
