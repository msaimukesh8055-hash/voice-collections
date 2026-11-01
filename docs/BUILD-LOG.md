# Build Log

The story of the build, newest first: three lines per step. Full detail (plans, decisions, test results, bugs and fixes) lives in [`docs/milestones/`](milestones/) and [`docs/adr/`](adr/).

---

**2026-11-01 · Docs simplified · ✅ Done**
Plan + report merged into one file per milestone; `delivery/` removed; build log cut to 3 lines per entry; SPEC updated (M7 go-live pack → one file, voice stack per ADR-0007).
18 → 14 doc files (≈20 expected at go-live instead of ≈35) · commit: pending

**2026-11-01 · M2 — Platform core + tools + compliance · 🟡 Planned**
Webhook with secret check and audit, five collections tools with verify-before-disclose in code, compliance engine (hours, do-not-call; attempt limits built but off), call authorisation; database proposed to move to Oregon next to Vapi.
Details → [`milestones/M2.md`](milestones/M2.md) · waiting on: Oregon project + go-ahead

**2026-11-01 · M1 — Voice spike · ✅ Done**
English and Hinglish browser calls work, replies in ~1.2 s; voice model moved off Gemini (too slow/overloaded) to Vapi-hosted GPT; Deepgram chosen for Hindi; 6/6 smoke tests, $0.65 credit.
Details → [`milestones/M1.md`](milestones/M1.md), [ADR-0007](adr/ADR-0007-voice-stack.md) · commits `03998a9`, `7b38f96` (pushed)

**2026-10-31 · M0 — Foundation · ✅ Done**
Strict TypeScript workspace with owner rules in lint, light-blue dashboard shell, Supabase schema (16 tables, RLS on all) with 8 fake borrowers, shared server core at 100% test coverage.
Details → [`milestones/M0.md`](milestones/M0.md) · commits `fb3d15d`, `fa175af` (pushed)

**2026-10-31 · Scope finalised · ✅ Done**
Core = collections voice agent + shared follow-up agent (rules first, agent for judgement, always writes a note); English + Hindi; lead qualification pending; Telugu and onboarding dropped.
Details → [`SPEC.md`](SPEC.md) · commit `181dd35` (pushed)

**2026-10-31 · Project setup · ✅ Done**
SPEC, four guidelines and eight build agents adapted from Saim's company SDLC rules; lean workflow with a quality gate every milestone and three checkpoints.
Details → [`SPEC.md`](SPEC.md), [`guidelines/`](../guidelines/) · commit `816c6d6` (pushed)
