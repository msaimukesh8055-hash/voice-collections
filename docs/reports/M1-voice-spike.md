# M1 Report — Voice Spike (English + Hindi)

**Branch:** `feature/M1-voice-spike` · **Plan:** `docs/plans/M1-plan.md` · **Decision record:** `docs/adr/ADR-0007-voice-stack.md` · **Date:** 2026-11-01

## Result

✅ **The voice stack works.** Real browser calls in English, Hindi and Hinglish, with interruptions, silence handling and replies starting in about **1.2 s**. One major change from the plan: the live agent runs on **Vapi-hosted `gpt-4.1-mini`**, not Gemini (Gemini's free tier was overloaded and too slow; evidence in ADR-0007).

## Acceptance criteria

| Criterion (SPEC M1) | Status | Evidence |
|---|---|---|
| 1-minute call works in English and Hindi from the browser | ✅ | English 75–90 s, Hindi 71 s (Azure), Hinglish 88 s (Deepgram) |
| Interrupting the agent makes it stop and listen | ✅ | 3–6 interruptions per call, all honoured |
| Latency measured and recorded | ✅ | English 1.15–1.27 s, Hinglish 1.26 s average reply (Vapi call metrics) |
| Gemini-as-agent-model question answered | ✅ **Doesn't work** | No reply in 20 s; 503/429 from Google; 2.5-flash 3–5 s. Fallback: Vapi-hosted GPT (Saim's choice) |
| Findings and settings recorded in ADR-0007 | ✅ | ADR-0007 accepted; ADR-0004 amended |

## Smoke test (Saim, real voice in Chrome)

| # | Test | Result | Notes |
|---|---|---|---|
| 1 | English call | ✅ 1.1–1.3 s replies | Natural; stays on "test call" script as instructed |
| 2 | Hindi · Deepgram (Hinglish) | ✅ 1.26 s | Mixed script transcript; Asha replied in natural Hinglish |
| 3 | Hindi · Azure | ✅ works, 2.4 s | Slow because of 1.5 s end-of-speech wait → cut to 0.8 s for Hindi |
| 4 | Hinglish mixing | ✅ | Deepgram `multi` clearly better than Azure |
| 5 | Interruption | ✅ | Stops within ~0.2 s of the caller speaking; maybe too eager — revisit in M3 |
| 6 | Silence | ✅ | "Are you still there?" once, then ends on its own, no error shown |

**Credit used:** $0.65 (9 calls, 8.8 minutes). Model cost per call ≈ $0.001–0.002; most of the cost is Vapi's platform fee.

## Decisions taken during the milestone (Saim)

1. Live agent model → **Vapi-hosted `gpt-4.1-mini`** (over Gemini 2.5 Flash or our own Gemini proxy).
2. Hindi end-of-speech wait → **0.8 s** (English stays 1.5 s).
3. Hindi speech-to-text → **Deepgram `multi`**; Azure option removed. The page now offers **English** and **Hindi**.
4. Call cap stays **2 minutes**, including on demo day.

## Problems hit → fixes

| Problem | Cause | Fix |
|---|---|---|
| Blank page: "Vapi is not a constructor" | SDK is CommonJS; the dev server returns `{ default: Vapi }` | `resolveVapiClass()` handles both shapes + test |
| Agent never replied | Gemini free tier: no response / 503 / 429 | Switched model (ADR-0007) |
| Every transcript line shown twice | SDK's `removeAllListeners()` removes nothing; React StrictMode's first subscription stayed attached | Remove each listener by name + StrictMode-cycle test. First attempt (timestamp de-duplication) was wrong — Vapi sends no timestamp — and was removed |
| Red error banner at normal call end | SDK reports "Meeting has ended" as an error | Treated as a normal hang-up + test |
| Hindi replies 2.4 s | Vapi waited the full 1.5 s on unpunctuated Hindi transcripts | Per-language end-of-speech wait (Hindi 0.8 s) |
| Test page unreachable | App stopped the idle dev server | Restarted; dev server no longer reloads the page when coverage files change (a reload would drop a live call) |

How the duplicate bug was found: a short real call in the app's browser pane with a silent fake microphone, tapping the SDK's events — it showed one message from Vapi but two listeners on the page.

## Deviations from plan

| Deviation | Why |
|---|---|
| Live model is Vapi-hosted GPT, not Gemini | Gemini free tier failed on availability and latency (ADR-0007) |
| `ensureGoogleCredential` built, then removed | Not needed once the voice model moved off Gemini |
| `GEMINI_API_KEY` not used in M1 | Still needed from M3 (summaries, follow-ups, evals) |
| Added `web-prod` preview config | To check the production build renders (CommonJS import differs from dev) |

## Quality gate

| Check | Result |
|---|---|
| Format, lint (owner rules), typecheck | ✅ |
| Agent + scripts tests | ✅ 20/20, 100% coverage |
| Dashboard tests | ✅ 18/18, 94% statements |
| Edge Function tests | ✅ 14/14, 100% |
| Production build | ✅ (bundle 644 KB, 180 KB gzipped — mostly the Vapi SDK; see backlog) |
| Bundle secret scan | ✅ none of 5 secrets present |
| Assistant on Vapi | ✅ pushed and read back (model, transcriber, voice, interruption, 120 s cap) |
| Smoke test | ✅ 6/6 (above) |

## Backlog / follow-ups

- **Name pronunciation:** call transcripts show "Suvida Finance" — the voice likely drops the "dh". Fix with phonetic spelling in M3.
- **Interruption sensitivity:** fine for now; tune in M3 if noise or "haan" cuts Asha off.
- **Bundle size:** load the Vapi SDK only when a call starts (M5).
- **Unused Gemini credential on Vapi:** can be deleted from the Vapi dashboard (Saim).
- **SPEC still says Gemini for the agent model** — not edited; Saim to decide whether to update the stack table.
- **Call screen design (Saim's idea):** "Dialling…" state, two avatars (Asha left, borrower right), arrow animating toward whoever is speaking, transcript below → M5 plan.
