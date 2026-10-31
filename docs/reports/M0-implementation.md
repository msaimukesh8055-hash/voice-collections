# M0 Implementation Report — Foundation

**Branch:** `feature/M0-foundation` · **Plan:** `docs/plans/M0-plan.md` · **Date:** 2026-10-31

## Plan items

| Item | Status |
|---|---|
| Root scaffold: npm workspaces, strict TS, ESLint (+ owner rules), Prettier, `.env.example` | ✅ |
| Web app: Vite 8 + React 19 + Tailwind 4, light-blue tokens, placeholder page, Vitest | ✅ |
| Supabase config + Deno (project dependency) | ✅ |
| `_shared/env.ts`, `errors.ts`, `schemas/customer.ts`, `schemas/loan.ts` (TDD) | ✅ |
| Migrations: schema (16 tables, pgvector) + RLS on all tables | ✅ applied to cloud project |
| Seed: 8 borrowers (EN/HI) with history, notes, promises, a handoff, a scheduled follow-up | ✅ applied |
| `scripts/db-push.ts`, `scripts/check-seed.ts` | ✅ |
| `docs/architecture.md` + ADR-0001…0006 | ✅ |
| `docs/delivery/requirements.md`, `user-stories.md` | ✅ |
| README, folder READMEs | ✅ |

## Decisions applied (from plan)

1. Deno installed as a project dev-dependency (`deno@2.9.6`) — no global install.
2. Cloud-only Supabase (no Docker) — ADR-0003.
3. Zod schemas live once in `supabase/functions/_shared/schemas/`; web imports via `@shared` alias.

## Deviations

| Deviation | Why |
|---|---|
| Migration files named `20261031000001_schema.sql` / `…02_rls.sql` (plan said `0001_schema.sql`) | Supabase CLI convention (timestamp prefix) |
| ESLint pinned to v9 (v10 available) | `eslint-plugin-react` doesn't support ESLint 10 yet; v9 is flagged end-of-support → backlog item |
| RLS uses `enable` only (not `force`) | `force` would also block the seed/owner role; anon/authenticated are still fully blocked (verified) |
| Prettier skips `*.md` and `*.sql` | Keep hand-written docs and SQL layout stable |
| Added `.claude/launch.json` | Lets the dashboard preview start in the app's browser pane |

## Owner rules enforced automatically

- `react/jsx-no-bind` (arrow functions banned in JSX props) → named handlers only
- `no-explicit-any`, `no-console`, `max-lines` 800, `max-lines-per-function` 50, `max-depth` 4, `max-params` 3
- Deno lint: `no-console`, explicit return types

## Quality gate

| Check | Result |
|---|---|
| `prettier --check` | ✅ |
| `eslint --max-warnings=0` | ✅ (1 unused-variable error found and fixed) |
| `tsc` (root scripts + web) | ✅ |
| Web tests (Vitest) | ✅ 2/2 |
| `vite build` | ✅ |
| `deno lint` / `deno check` | ✅ |
| Edge Function tests (Deno) | ✅ 14/14 · **100%** branch/line coverage on env, errors, schemas |
| `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Banned patterns (`console.`, `any`) | ✅ none |
| Smoke: `db:check-seed` | ✅ all 9 tables match expected counts; anon key blocked from `customers` |
| Smoke: dashboard page in browser | ✅ renders; background `#f0f6ff`, text `#0f1f33` |

## Tests

| Suite | Run | Passed | Failed | Coverage |
|---|---|---|---|---|
| Edge Functions (Deno) | 14 | 14 | 0 | 100% (all files) |
| Web (Vitest) | 2 | 2 | 0 | App.tsx covered |

## Known gaps / backlog

- ESLint 9 end-of-support → upgrade to 10 when `eslint-plugin-react` supports it.
- No local DB for integration tests (ADR-0003); integration tests in M2 will run handlers against injected fakes.
- Prototype region EU; production would be Mumbai (ADR-0003).
