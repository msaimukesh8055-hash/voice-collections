# Suvidha Finance — Voice AI Collections (prototype)

A mock client implementation of a voice collections agent for a fictional Indian NBFC, built on Vapi + Supabase + Gemini. **All data is fake.** Scope: [`docs/SPEC.md`](docs/SPEC.md) · Architecture: [`docs/architecture.md`](docs/architecture.md).

## Setup

1. Node 20+ (tested on 25). No global Deno or Docker needed — Deno installs as a project dependency.
2. `npm install`
3. Copy `.env.example` → `.env` and fill in the Supabase values (never commit `.env`).
4. `npm run db:push` — applies migrations + seed to the linked Supabase project.
5. `npm run db:check-seed` — verifies seed counts and that the browser key cannot read data.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dashboard dev server |
| `npm run check` | Full quality gate: lint, typecheck, web tests, build, Edge Function lint/check/tests |
| `npm run fn:coverage` | Edge Function coverage report |
| `npm run db:push` | Apply migrations + seed |
| `npm run db:check-seed` | Seed + RLS smoke test |
| `npm run functions:deploy` | Upload function secrets, deploy `vapi-webhook` + `calls-api` |
| `npm run smoke:webhook` | End-to-end tool-call check on the deployed functions (no voice credit) |
| `npm run agent:push` | Publish Asha's config (tools, prompt, webhook address) to Vapi |

## Repository layout

```
web/          dashboard (Vite + React + Tailwind, light-blue theme)
supabase/     migrations, seed, Edge Functions (_shared core)
voice-agents/ voice agent configs as code (prompts, languages, tools) — pushed to Vapi
knowledge/    policy documents for RAG
evals/        simulated conversations, judge, release gate
docs/         spec, architecture, ADRs, build log, milestones (plan + results), checkpoint reviews
guidelines/   coding, testing, security, workflow standards
```
