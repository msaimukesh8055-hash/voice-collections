# CLAUDE.md — Voice Collections Agent

## What this is

A portfolio prototype for a fictional Indian NBFC, **Suvidha Finance**, delivered as a mock client implementation — requirements → design → build → test → go-live. Built to demonstrate the GreyLabs AI *Platform FDE / AI Program Manager* skill set. Full scope: `docs/SPEC.md`.

- **Collections voice agent** (English + Hindi) on Vapi
- **Follow-up agent** — rules for clear cases, agent for judgement calls, always writes a note the voice agent reads next call
- **Dashboard**, **evals + release gate**
- *Pending:* lead qualification voice agent (only after the core works)

**Owner:** Saim (product manager; makes product decisions). **Claude** writes all code and explains engineering concepts in plain English.

## Always read first

| File | What it governs |
|---|---|
| `docs/SPEC.md` | Scope, milestones, acceptance criteria |
| `guidelines/workflow.md` | Milestone pipeline, approval stops, scoring, git |
| `guidelines/coding-standards.md` | How code must look |
| `guidelines/testing.md` | How code is tested; unit tests vs agent evals |
| `guidelines/security.md` | Secrets, data access, BFSI compliance rules |
| `docs/architecture.md` + `docs/adr/` | Architecture and decisions (once created) |

Agents in `.claude/agents/`: `architect`, `designer`, `implementer`, `tester`, `fixer`, `reviewer`, `refactorer`, `evaluator`. The main session is the **coordinator**: it runs them in the order defined in `guidelines/workflow.md` and holds the approval stops.

## Owner's rules (non-negotiable)

- **Plan first.** No code until Saim says "go ahead" or "confirmed" on the milestone plan.
- **Concise, direct, plain English.** No jargon without a one-line explanation.
- **TypeScript always.** No `any`.
- **UI theme: very light blue background across all screens** (project exception to the global "dark themes preferred" rule, decided by Saim). One light theme, no dark toggle.
- **Prompts and experiment choices are Saim's decisions.** Explain key design decisions in plain English at each milestone.
- **No hardcoded secrets** — environment variables only.
- **No anonymous inline JSX handlers** — named functions only.
- **File path comment** at the top of every source file.
- **Never commit without asking. Never push** unless explicitly told.
- **Fake data only.**

## Stack

| Layer | Choice |
|---|---|
| Voice platform | Vapi (browser web calls via `@vapi-ai/web`; no phone numbers) |
| Live voice agent LLM | Vapi-hosted `gpt-4.1-mini` (ADR-0007; Gemini free tier too slow for live voice) |
| Speech | Deepgram Nova-3 (English, Hindi/Hinglish) · Azure Indian neural voices |
| Summaries, follow-ups, embeddings, evals | Google Gemini (free tier) |
| Frontend | Vite + React + TypeScript + Tailwind (light-blue theme) |
| Backend | Supabase Edge Functions (Deno) |
| Database | Supabase Postgres + pgvector |
| Validation | Zod (schemas shared between web and functions) |
| Tests | Vitest + React Testing Library, `deno test`, Playwright |
| Hosting | Vercel (web), Supabase (functions + DB) |

## Repo layout (target)

```
web/                      Vite React dashboard + call simulator
supabase/
  migrations/             SQL schema + RLS
  seed.sql                fake customers and loans
  functions/
    _shared/              schemas/, compliance/, tools/, db, errors, env
    vapi-webhook/         tool calls + end-of-call reports from Vapi
    calls-api/            /v1/calls, /v1/loans for the dashboard
voice-agents/             the product's voice agents as code: prompt, languages, voice, model, tools (pushed to Vapi)
knowledge/                fake NBFC policy documents (RAG source)
evals/                    scenarios, simulator, judge, runner
docs/                     SPEC, architecture, ADRs, BUILD-LOG, milestones (plan + results), reviews (checkpoints)
guidelines/               shared standards
```

## Budget guardrails

- Target spend ₹0; hard cap ₹1,000.
- Vapi free credit is small (~$5–10): **voice minutes are for manual testing and the demo only.** All bulk testing runs as text evals on free Gemini.
- Never add a paid service or phone number without asking.

## Mode

**Lean mode** (8-hour build) — see `guidelines/workflow.md`:
- Every milestone: short plan → STOP → build + tests → **quality gate** (build, lint, typecheck, tests, standards, security, deployed, smoke test) → STOP → ask to commit.
- Full review (`reviewer` + `evaluator`) only at checkpoints CP1 (after M2), CP2 (after M4), CP3 (before go-live, with `refactorer`).
- **Quality never relaxes; paperwork does.** If a time box runs out, cut scope using the SPEC cut order — never skip the quality gate.
