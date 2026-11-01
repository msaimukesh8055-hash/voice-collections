# Build Log

A running record of what was built, decided and verified at every step — newest first. Updated by the coordinator at each approval point and committed with the work it describes.

Each entry: **what was built** · **key decisions** · **evidence** (tests, smoke tests, scores) · **problems hit and how they were fixed** · **commits**.

---

## 2026-11-01 · M1 — Voice spike · ✅ Done

- **Built:** agent config as code (`agent/`: Zod schema, per-language settings, Vapi payload builder); `npm run agent:push` creates/updates the Vapi assistant; bundle secret scan in the quality gate; voice test page (language picker, start/end call, live status, transcript) on a thin, tested Vapi SDK wrapper.
- **Key decisions (Saim, on evidence):** live agent runs on **Vapi-hosted `gpt-4.1-mini`** — Gemini's free tier didn't reply (503/429) and its one working model took 3–5 s; **Deepgram** for English and Hindi (handles Hinglish, ~⅓ of Azure's cost); Azure Indian voices; Hindi end-of-speech wait 0.8 s; 2-minute call cap including demo day. Recorded in [ADR-0007](adr/ADR-0007-voice-stack.md); ADR-0004 amended.
- **Evidence:** smoke test 6/6 — English replies 1.15–1.27 s, Hinglish 1.26 s (target < 1.5 s); interruptions honoured every time; silence prompts once then ends cleanly. Tests: 20/20 agent+scripts (100%), 18/18 dashboard (94%), 14/14 Edge Functions (100%); secret scan clean. Credit used: **$0.65** (9 calls, 8.8 min).
- **Problems → fixes:** blank page (Vapi SDK is CommonJS) → resolve both import shapes; Gemini no reply → model switch; every line shown twice (SDK's `removeAllListeners` removes nothing, React StrictMode left a listener attached — found by tapping SDK events during a real call) → remove listeners one by one, first wrong fix removed; false error banner at normal hang-up → treated as normal end; Hindi 2.4 s replies → 0.8 s wait; dev server reloading on coverage files (would drop a call) → ignored.
- **Report:** [`docs/reports/M1-voice-spike.md`](reports/M1-voice-spike.md)
- **Commits:** _pending Saim's approval_

---

## 2026-10-31 · M0 — Foundation · ✅ Done

- **Built:** npm workspaces with strict TypeScript; ESLint enforcing owner rules (no inline JSX handlers, no `any`, no `console`, size limits); Prettier; Vite + React + Tailwind dashboard shell (light-blue theme); Edge Functions shared core (env loader, error-code map, Zod schemas) written test-first; Supabase schema (16 tables, pgvector) with RLS on every table; fake seed data (8 borrowers with history); push + seed-check scripts.
- **Docs:** architecture, ADR-0001…0006, client requirements, user stories.
- **Decisions:** Deno as a project dependency (no global install); Supabase cloud only (no Docker); one shared copy of each Zod schema.
- **Evidence:** 14/14 Edge Function tests at 100% coverage; 2/2 web tests; lint/types/build/format green; `npm audit` 0 vulnerabilities; seed smoke test passed — all 9 tables match, and the browser key is **blocked** from reading customer data; page renders with `#f0f6ff` background.
- **Problems → fixes:** ESLint 10 incompatible with React plugin → pinned v9 (backlog to upgrade); one unused variable caught by lint → fixed; preview config passed the port as a folder (blank page) → fixed launch config; Supabase CLI warned about future default target → push script now targets the linked project explicitly.
- **Report:** [`docs/reports/M0-implementation.md`](reports/M0-implementation.md)
- **Commits:** `fb3d15d` (M0), `fa175af` (merge to main) — pushed to GitHub.

---

## 2026-10-31 · Scope finalised · ✅ Done

- **Decided with Saim:** collections voice agent + shared follow-up agent (rules for clear cases, agent for judgement calls, always writes a note) as the core; lead qualification pending; Telugu and onboarding dropped; English + Hindi; summary and compliance check are AI steps, not agents; demo controls (clock, payment toggle, run follow-ups now); very light-blue dashboard; Saim owns prompts and experiment choices.
- **Commit:** `181dd35` — pushed.

---

## 2026-10-31 · Project setup · ✅ Done

- **Built:** `docs/SPEC.md`; four shared guidelines (coding standards, testing, security, workflow) adapted from Saim's company SDLC rules; eight build agents in `.claude/agents/` (architect, designer, implementer, tester, fixer, reviewer, refactorer, evaluator); `CLAUDE.md`; lean workflow (quality gate every milestone, full review at three checkpoints).
- **Commit:** `816c6d6` — GitHub repo created and pushed.
