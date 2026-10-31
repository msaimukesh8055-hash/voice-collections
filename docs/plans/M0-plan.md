# M0 Plan — Foundation

**Branch:** `feature/M0-foundation` · **Time box:** 45 min · **Status:** awaiting approval (STOP 1)

## Goal

An empty but fully wired project: every check command runs green, the database exists in Supabase with fake data, and the architecture and first client documents are written. Nothing a customer sees yet.

## Acceptance criteria (from SPEC M0)

- Lint, typecheck and test commands run green on the scaffold (web + Edge Functions)
- Database schema + access rules (RLS) applied to the Supabase project; seed data loaded and counted
- `docs/architecture.md` + 6 ADRs written
- `docs/delivery/requirements.md` and `user-stories.md` written

## Environment found

| Tool | Status |
|---|---|
| Node 25 / npm 11 | ✅ installed |
| Supabase CLI 2.122 | ✅ works via `npx` |
| Deno | ❌ not installed |
| Docker | ❌ not installed |

## Decisions

### Decision 1: How to get Deno (needed to lint/test Edge Functions)
🔍 **Ambiguity:** Edge Functions run on Deno, which isn't installed.
📊 **Options analysed:**
  (a) Install Deno globally on Windows — works, but a manual step on every machine
  (b) Add Deno as a project dev-dependency (official `deno` npm package, v2.9.6) — installs with `npm install`, same version for everyone
  (c) Skip Deno checks — breaks the quality gate
✅ **My decision:** (b)
📐 **Reasoning:** reproducible, no global install, keeps the quality gate intact.
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

### Decision 2: Local database vs cloud only
🔍 **Ambiguity:** Supabase's local stack needs Docker, which isn't installed.
📊 **Options analysed:**
  (a) Install Docker Desktop — heavy (GBs), slow to set up, eats into the 8 hours
  (b) Use the cloud Supabase project only; unit tests use fakes, never a real DB
✅ **My decision:** (b)
📐 **Reasoning:** the testing guideline already says unit tests use fakes; the cloud project is free; saves ~30+ minutes. Recorded in ADR-0003.
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

### Decision 3: Sharing Zod schemas between dashboard (Node/Vite) and Edge Functions (Deno)
🔍 **Ambiguity:** the two runtimes import packages differently; the coding standard says one copy of each schema.
📊 **Options analysed:**
  (a) Copy schemas into both — violates "no duplication"
  (b) Schemas live once in `supabase/functions/_shared/schemas/`; Deno maps `zod` via its import map, Vite maps a `@shared` alias to the same folder
✅ **My decision:** (b)
⚠️ **Override?** Tell me if you disagree; otherwise I proceed with this.

## Files to create

```
package.json                    npm workspaces (web, evals, scripts) + root check scripts
.env.example                    every env var, blank values
.prettierrc, eslint.config.js   shared formatting + lint rules (--max-warnings=0)
tsconfig.base.json              strict TypeScript, shared by all packages
web/                            Vite 8 + React + TypeScript + Tailwind 4 (light-blue tokens), one placeholder page, Vitest
supabase/
  config.toml                   project config
  migrations/0001_schema.sql    all core tables from SPEC §10 + pgvector
  migrations/0002_rls.sql       RLS on every table; no browser access to customer data
  seed.sql                      ~8 fake borrowers (EN/HI), loans, prior calls, notes, promises
  functions/deno.json           import map (zod), lint + test config
  functions/_shared/env.ts      Zod-validated env loader (fail fast)
  functions/_shared/errors.ts   ERROR_CODES map
  functions/_shared/schemas/    first shared schemas (customer, loan)
agent/, knowledge/, evals/      empty folders with a one-line README each
scripts/check-seed.ts           counts seeded rows (smoke test)
docs/architecture.md
docs/adr/ADR-0001 … ADR-0006
docs/delivery/requirements.md, user-stories.md
README.md                       setup + commands
```

Lead-qualification tables are **not** created now (pending scope — YAGNI).

## ADRs to write

1. Vapi browser web calls (no phone numbers)
2. Single webhook + typed tool registry
3. Supabase cloud-only (Postgres + pgvector + Edge Functions), no local Docker stack
4. Gemini free tier for agent, evals and embeddings
5. Verify-before-disclose enforced in code, not only in the prompt
6. One live voice agent + post-call follow-up agent; rules before agent

## Env vars introduced

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
(Vapi and Gemini keys are added in M1.)

## Test list

| Test | Type | TDD | 100% |
|---|---|---|---|
| Env loader rejects missing/blank required vars, accepts valid set | Unit (Deno) | ✅ | ✅ (validation) |
| Error-code map returns safe message, never internal detail | Unit (Deno) | ✅ | ✅ |
| Customer/loan schemas accept seed-shaped data, reject bad data (negative amount, bad language code) | Unit (Deno) | ✅ | ✅ |
| Placeholder page renders with the theme | Unit (Vitest + RTL) | — | — |
| Seed counts match expected (8 customers, 8 loans, …) | Smoke script against cloud DB | — | — |

## Quality gate for M0

`npm run check` = web lint + typecheck + test, functions `deno lint` + `deno check` + `deno test` — all green · migrations applied · `check-seed` passes · standards + security checklists.

## What I need from you before I build

1. **Supabase project** created (free), then into a local `.env` file (I'll create it from `.env.example`; you paste values in — **not in chat**):
   - Project URL, anon key, service-role key → Settings → API
   - Project ref (the id in the URL) and the database password you set
   - An access token → Account → Access Tokens (lets the CLI apply migrations without an interactive login)
2. Say **"go ahead"** (or override any decision above).

## Risks

| Risk | Mitigation |
|---|---|
| `deno` npm package misbehaves on Windows | Fall back to a global Deno install (one command) |
| Migration push fails (network/password) | CLI error shown plainly; fix and re-run — migrations are idempotent on an empty project |
