# Easy Recovery AI (prototype)

A WhatsApp-first credit-recovery assistant for a small trader in Anantapur (fake persona: Srinivas Reddy, Sri Lakshmi Traders, ~100 fake shopkeepers). Asha, a reminder voice agent on **Sarvam Voice Agents**, calls shopkeepers in Telugu, Hindi or English. Built on Sarvam + Supabase (Mumbai) + React. **All data is fake.** Scope: [`docs/SPEC.md`](docs/SPEC.md) · Architecture: [`docs/architecture.md`](docs/architecture.md).

## Setup

1. Node 20+ (tested on 25). No global Deno or Docker needed — Deno installs as a project dependency.
2. `npm install`
3. Copy `.env.example` → `.env` and fill it in (never commit `.env`). Supabase project in **ap-south-1 (Mumbai)**. Sarvam needs two keys: `SARVAM_API_KEY` (speech, LLM) and `SARVAM_AGENTS_API_KEY` (Voice Agents, indus.sarvam.ai), plus org and workspace ids. `SARVAM_TOOL_SECRET` is a random 32+ character string you also store in Sarvam's Secrets vault as `easy-recovery-tool-secret`. The WhatsApp bot (M4) needs `META_ACCESS_TOKEN` (system-user token, never expires), `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_APP_SECRET`, a random `WHATSAPP_VERIFY_TOKEN`, the owner's number in `OWNER_WHATSAPP_NUMBER` (only number the bot answers; never stored) and `GEMINI_API_KEY` (fallback brain). The follow-up worker (M5) needs `WORKER_SECRET`, another random 32+ character string (calls-api and whatsapp-webhook send it to wake the worker; pg_cron reads it from Vault, see "Scheduler").
4. `npm run db:push` — applies migrations + seed to the linked Supabase project.
5. `npm run db:check-seed` — verifies seed counts, Ramesh's figures and that the browser key cannot read data.
6. `npm run functions:deploy` — uploads function secrets and deploys `sarvam-tools`, `calls-api`, `whatsapp-webhook` and `followup-worker`.
7. `npm run agent:build` — writes `voice-agents/asha/build/agent.json` to create/update Asha in Sarvam (see `voice-agents/README.md`). Put Asha's app id in `SARVAM_APP_ID`, then deploy the functions again.

## Connect WhatsApp (M4)

In Meta → WhatsApp → Configuration set **Callback URL** `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook` and **Verify token** = `WHATSAPP_VERIFY_TOKEN`, then subscribe to `messages`. Send "hi" from the owner's phone to the test number. Commands: `pending`, `closed`, `Ramesh`, `Ramesh 5000 due 15th`, `Ramesh paid 2000`, or free text in Telugu/Hindi/English. Every change waits for a **Save** tap.

## Try a call

1. `npm run dev`, open `http://localhost:5173/phone` in one Chrome window (allow the microphone) and `http://localhost:5173/` in another.
2. Press **Ring Ramesh** on `/`. The phone page rings; press **Accept** and talk to Asha. No answer in 30 s → missed.

3. When the call ends (or is declined or missed), `followup-worker` sends the owner a WhatsApp summary, usually within a minute; it waits up to 10 minutes for Sarvam's transcript. WhatsApp only delivers it if the owner messaged the bot in the last 24 hours.

To run every waiting follow-up by hand (e.g. after a lost wake-up): `curl -X POST -H "Authorization: Bearer $WORKER_SECRET" https://<project-ref>.supabase.co/functions/v1/followup-worker/sweep` (5 calls per run).

Voice minutes cost ₹3.50/min + GST: use them for manual checks and the demo only. Bulk testing runs as text evals.

## Reminders and simulated calls (M5)

On WhatsApp: `due` or `who is due?` lists broken promises, overdue and due today, with **Remind** buttons (or a list) and **Remind all due**. `remind Ramesh` reminds one person; `remind all` asks "Call N people?" first. Anyone called in the last hour, paused or on do-not-call is skipped, and at most 10 are called per tap. `why is Ramesh 42?` or `Ramesh score` explains the reliability score.

The shopkeeper on the phone page (Ramesh) gets a real voice call. Everyone else gets a **simulated** text call: Asha on `sarvam-105b` talks to a shopkeeper played by Gemini, up to 4 at once, about ₹1 each. Each one gets the same WhatsApp summary, marked simulated.

### Scheduler (pg_cron)

`npm run db:push` applies `20261106000001_reminders.sql`, which turns on `pg_cron` and `pg_net` and schedules three jobs: sweep every minute, promise check at 08:45 IST, due alert at 09:00 IST. The jobs need two Vault secrets. Set them once in the Supabase SQL editor (values from `.env`; do not save the query):

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/followup-worker', 'followup_worker_url');
select vault.create_secret('<WORKER_SECRET>', 'worker_secret');
```

Until both exist, each job logs a warning and does nothing. Check runs with `select * from cron.job_run_details order by start_time desc limit 10;`. To stop the jobs: `select cron.unschedule('followup-sweep');` (likewise `daily-promise-check`, `daily-due-alert`).

The daily alert goes out once per demo day. If the owner hasn't messaged the bot in the last 24 hours, WhatsApp only allows an approved template: create a **Utility** template named `daily_due_alert` (English) with body `Good morning. {{1}} shopkeepers are due today. Reply DUE to see them.` Replying DUE gets the full alert.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web dev server (`/` demo controls, `/phone` shopkeeper phone) |
| `npm run check` | Full quality gate: format, lint, typecheck, tests + coverage, build, bundle secret scan, Edge Function fmt/lint/check/tests |
| `npm run lint` | ESLint, zero warnings. Also checks the size limits (function ≤ 50 lines, ≤ 3 parameters, file ≤ 800 lines, nesting ≤ 4) on `supabase/functions`; `deno lint` covers the rest there |
| `npm run fn:coverage` | Edge Function coverage report |
| `npm run db:push` | Apply migrations + seed |
| `npm run db:check-seed` | Seed + RLS smoke test |
| `npm run seed:generate` | Regenerate `supabase/seed.sql` from the deterministic generator |
| `npm run functions:deploy` | Upload function secrets, deploy `sarvam-tools`, `calls-api`, `whatsapp-webhook`, `followup-worker` |
| `npm run smoke:tools` | End-to-end check on the deployed functions: ring → accept → 5 tools → ended (no voice credit) |
| `npm run smoke:whatsapp` | Signed fake Meta messages to the deployed webhook: verify, bad signature, stranger. Add `-- --send-to-owner` for pending / lookup / card → Save / duplicate id (**sends real WhatsApp replies to the owner**); cleans up its rows |
| `npm run smoke:reminders` | M5 reminder loop on the deployed functions: worker secret (401/202). Add `-- --send-to-owner` for "due" → Remind tap → one live call queued, then declined (no voice minutes) → follow-up; then one simulated call end to end → follow-up run + note (**sends real WhatsApp messages to the owner, about ₹1 of LLM**); cleans up its rows |
| `npm run agent:build` | Validate Asha's config and render the JSON to push to Sarvam |
| `npm run agent:record` | Record a committed Sarvam version of Asha in `publishes` |

## Repository layout

```
web/          demo controls + shopkeeper phone page (Vite + React + Tailwind, light-blue theme)
supabase/     migrations, seed, Edge Functions (_shared core, sarvam-tools, calls-api, whatsapp-webhook, followup-worker)
voice-agents/ voice agents as code (prompt, greetings, voice, languages, tools) — pushed to Sarvam
scripts/      seed generator, deploy, smoke tests, agent build/record
evals/        simulated conversations, judge, release gate (M7)
docs/         spec, architecture, ADRs, build log, milestones (plan + results), checkpoint reviews
guidelines/   coding, testing, security, workflow standards
```
