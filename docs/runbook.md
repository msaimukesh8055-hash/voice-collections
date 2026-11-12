# Runbook — Easy Recovery AI

What to do when something goes wrong, and how to do the routine things safely. Written 2026-11-12. Commands run from the repository root.

## Where to look first

| Question | Where |
|---|---|
| Is it up? | `GET <SUPABASE_URL>/functions/v1/calls-api/v1/health` → 200 `ok`, or 503 `degraded` (database unreachable) |
| What failed, and how often? | Dashboard → **Ops**: error rate, latest errors, per-function table |
| What happened to one request? | Ops → click an error → its trace: every step in order with timings |
| Is the AI still behaving? | Dashboard → **Evals** |
| Raw logs | Supabase dashboard → Edge Functions → the function → Logs. Every line carries a `trace_id` |

Traces and logs hold ids, codes and timings only. They never hold names, phone numbers or amounts, so they are safe to paste into a ticket.

## An alert arrived on WhatsApp

The alert names the function, the step and an error code, and links to one trace.

1. Open the link. Read the steps top to bottom; the first red one is the cause.
2. Match the step to a section below.
3. One alert is sent per problem per 15 minutes. No second alert in the next window means it stopped.

If the link opens the dashboard asking for a WhatsApp link, the token expired (24 hours): send `dashboard` to the bot and open `/ops` from the new link.

## Stop the damage first: pause reminder calls

Send **`/pause`** to the bot. No new reminder call starts, live or simulated; calls already in progress finish. The Ops page shows "Reminder calls: Paused". Send **`/resume`** to turn them back on.

Use it when Asha says something she should not, when a tool is failing mid-call, or when you are unsure. Pausing costs nothing and is undone in one message.

Without WhatsApp (the bot itself is down): in the Supabase SQL editor,

```sql
update public.demo_settings set calls_paused = true where id = 1;
```

## By symptom

| Symptom on the trace or page | Likely cause | What to do |
|---|---|---|
| `brain_llm` warn with `HTTP 5xx` or a timeout, provider `sarvam`, then `gemini` ok | Sarvam's LLM is down or slow | Nothing: the fallback is working. Watch "Rejected LLM answers" on the Ops page |
| `brain_llm` warn for both providers; owner got "Sorry, I didn't get that" | Both LLMs down | Fixed commands and buttons still work (68% of messages). Tell the owner to use the menu. Check both providers' status pages |
| `whatsapp_send_failed` | Meta refused a message: token expired, the 24-hour window closed, or the number is blocked | The error shows Meta's code. A 24-hour-window refusal clears when the owner writes to the bot. For a token problem, replace `META_ACCESS_TOKEN` and redeploy |
| `whatsapp_bad_signature` (warning) | A request that did not come from Meta, or `META_APP_SECRET` is wrong | A few are background noise. If every message fails, the secret is wrong: fix it and redeploy |
| `card_save_failed`, `whatsapp_route_failed`, `RepositoryError` | The database refused or timed out | Check `/health`. The card reopens by itself, so the owner can tap Save again; nothing is half-saved |
| `call_not_authorised` with `token_expired` or `not_active` | A tool call arrived after the call ended, or more than 10 minutes after it was accepted | Expected at the end of calls. Many in a row mid-call means the phone page and the tools disagree: pause calls and check the trace |
| "Follow-up queue: N stuck" | The follow-up worker is failing or Sarvam's transcript is late | Open the worker's errors on the Ops page. To retry by hand: `POST /functions/v1/followup-worker/sweep` with the worker secret |
| Tool latency "Over" target | Cold start, or a slow database read | Compare p50 and p95: a low p50 with a high p95 is cold starts. A high p50 is a real slowdown |
| Asha or Munshi says something wrong | Prompt or model behaviour | `/pause`, then "Put back the previous agent version" below. Add the conversation as an eval case before fixing it |

## Put back the previous agent version

The prompts live in `voice-agents/` and every published version is recorded in the `publishes` table (agent, prompt hash, Sarvam version).

1. `/pause`.
2. Find the last good commit of the prompt: `git log --oneline -- voice-agents/asha/prompt.ts`.
3. Restore that file content on a branch, run `npm run agent:build`, and push the built agent to Sarvam (through the Sarvam connector, as in `voice-agents/README.md`).
4. Run the evals against the new draft: `npm run evals:asha -- --version <draft number>`. Commit the version in Sarvam only if the gate passes.
5. `npm run agent:record`, then `/resume`.

This rolls **forward** to the old wording as a new version. Whether Sarvam can point an agent back at an older committed version directly was not verified; this path does not depend on it. **It has not been rehearsed end to end.**

## Routine operations

| Task | Command | Notes |
|---|---|---|
| Full quality gate | `npm run check` | Also runs on GitHub on every push |
| Deploy functions | `npm run functions:deploy` | Uploads secrets from `.env` and deploys all five |
| Apply database migrations | `npm run db:push` | Migrations only |
| **Wipe and reseed the demo book** | `npm run db:reseed` | **Destroys every call, promise and entry made since the seed.** Only for a deliberate reset |
| Brain evals | `npm run evals:brain` | A few LLM calls |
| Asha evals | `npm run evals:asha -- --version <n>` | Spends Sarvam credits. If the script dies mid-run, collect the paid run with `--resume <suite>,<run>` (both ids are printed) |

## A secret leaked

1. `/pause`.
2. Rotate the leaked secret at its source, then update `.env` and run `npm run functions:deploy`.

| Secret | Rotate at | Also update |
|---|---|---|
| `META_ACCESS_TOKEN`, `META_APP_SECRET` | Meta developer console | – |
| `SARVAM_API_KEY`, `SARVAM_AGENTS_API_KEY` | Sarvam dashboard | GitHub secrets, if the evals workflow is set up |
| `SARVAM_TOOL_SECRET`, `SARVAM_OWNER_TOOL_SECRET` | Generate a new value | The same value in Sarvam's secrets vault for each agent's tools |
| `WORKER_SECRET` | Generate a new value | Supabase Vault (`worker_secret`), or the scheduled jobs stop |
| `DASHBOARD_LINK_SECRET`, `MUNSHI_LINK_SECRET` | Generate a new value | Every link already sent stops working |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings | Everything; this key bypasses row-level security |

3. Check the Ops page for requests you did not make during the exposure window.

## Known limits

- One trader, one WhatsApp test number that reaches only registered numbers, browser calls only, fake data.
- An alert can itself be refused by WhatsApp's 24-hour rule; the Ops page is the backup.
- Eval runs leave their fake rows (one "eval owner" per run) and one suite in Sarvam. Nothing cleans them up yet.
- Ops events are kept for 14 days (token counts longer).
