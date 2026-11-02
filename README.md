# Easy Recovery AI (prototype)

A WhatsApp-first credit-recovery assistant for a small trader in Anantapur (fake persona: Srinivas Reddy, Sri Lakshmi Traders, ~100 fake shopkeepers). Asha, a reminder voice agent on **Sarvam Voice Agents**, calls shopkeepers in Telugu, Hindi or English. Built on Sarvam + Supabase (Mumbai) + React. **All data is fake.** Scope: [`docs/SPEC.md`](docs/SPEC.md) · Architecture: [`docs/architecture.md`](docs/architecture.md).

## Setup

1. Node 20+ (tested on 25). No global Deno or Docker needed — Deno installs as a project dependency.
2. `npm install`
3. Copy `.env.example` → `.env` and fill it in (never commit `.env`). Supabase project in **ap-south-1 (Mumbai)**. Sarvam needs two keys: `SARVAM_API_KEY` (speech, LLM) and `SARVAM_AGENTS_API_KEY` (Voice Agents, indus.sarvam.ai), plus org and workspace ids. `SARVAM_TOOL_SECRET` is a random 32+ character string you also store in Sarvam's Secrets vault as `easy-recovery-tool-secret`.
4. `npm run db:push` — applies migrations + seed to the linked Supabase project.
5. `npm run db:check-seed` — verifies seed counts, Ramesh's figures and that the browser key cannot read data.
6. `npm run functions:deploy` — uploads function secrets and deploys `sarvam-tools` + `calls-api`.
7. `npm run agent:build` — writes `voice-agents/asha/build/agent.json` to create/update Asha in Sarvam (see `voice-agents/README.md`). Put Asha's app id in `SARVAM_APP_ID`, then deploy the functions again.

## Try a call

1. `npm run dev`, open `http://localhost:5173/phone` in one Chrome window (allow the microphone) and `http://localhost:5173/` in another.
2. Press **Ring Ramesh** on `/`. The phone page rings; press **Accept** and talk to Asha. No answer in 30 s → missed.

Voice minutes cost ₹3.50/min + GST: use them for manual checks and the demo only. Bulk testing runs as text evals.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web dev server (`/` demo controls, `/phone` shopkeeper phone) |
| `npm run check` | Full quality gate: format, lint, typecheck, tests + coverage, build, bundle secret scan, Edge Function fmt/lint/check/tests |
| `npm run fn:coverage` | Edge Function coverage report |
| `npm run db:push` | Apply migrations + seed |
| `npm run db:check-seed` | Seed + RLS smoke test |
| `npm run seed:generate` | Regenerate `supabase/seed.sql` from the deterministic generator |
| `npm run functions:deploy` | Upload function secrets, deploy `sarvam-tools` + `calls-api` |
| `npm run smoke:tools` | End-to-end check on the deployed functions: ring → accept → 5 tools → ended (no voice credit) |
| `npm run agent:build` | Validate Asha's config and render the JSON to push to Sarvam |
| `npm run agent:record` | Record a committed Sarvam version of Asha in `publishes` |

## Repository layout

```
web/          demo controls + shopkeeper phone page (Vite + React + Tailwind, light-blue theme)
supabase/     migrations, seed, Edge Functions (_shared core, sarvam-tools, calls-api)
voice-agents/ voice agents as code (prompt, greetings, voice, languages, tools) — pushed to Sarvam
scripts/      seed generator, deploy, smoke tests, agent build/record
evals/        simulated conversations, judge, release gate (M7)
docs/         spec, architecture, ADRs, build log, milestones (plan + results), checkpoint reviews
guidelines/   coding, testing, security, workflow standards
```
