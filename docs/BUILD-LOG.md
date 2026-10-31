# Build Log

A running record of what was built, decided and verified at every step — newest first. Updated by the coordinator at each approval point and committed with the work it describes.

Each entry: **what was built** · **key decisions** · **evidence** (tests, smoke tests, scores) · **problems hit and how they were fixed** · **commits**.

---

## 2026-10-31 · M1 — Voice spike · 🟡 Planned

- **Plan:** [`docs/plans/M1-plan.md`](plans/M1-plan.md) — first real browser call in English and Hindi; interruption and latency tests; answer whether Gemini can power the Vapi agent.
- **Decisions proposed:** Gemini route fallback chain (built-in Google → OpenAI-compatible custom LLM → Vapi default); one assistant with per-call language settings; test Deepgram vs Azure for Hindi and choose by evidence.
- **Waiting on:** Vapi + Gemini keys in `.env`; Saim's go-ahead.

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
