# ADR-0016: Follow-up worker — rules first, agent for mixed signals, done once per call

## Status
Accepted (M5 half 5a, 2026-11-03; 5b addendum below). Builds on ADR-0006 (live agent + follow-up agent; rules before agent), ADR-0014 (Sarvam LLM, checked JSON) and ADR-0015 (background work, cards). Prompts are drafts until Saim approves them.

## Context
After every call (completed, declined or missed) the owner needs a short WhatsApp summary and a next step, and Asha needs a note for her next call. Sarvam's transcript can arrive minutes after the call ends. calls-api answers the phone page and must stay fast. A retried or duplicated job must never send two summaries or write two notes. An LLM should only judge what plain rules can't, and it must never change the money book.

## Decision
- **A separate function, `followup-worker`**, deployed without Supabase JWT checks. Callers (calls-api, the worker itself, and 5b's pg_cron) send `WORKER_SECRET` as a bearer token, checked in constant time before anything else (`_shared/auth/bearer.ts`, shared with `sarvam-tools`). It answers 202 at once and works in the background (`EdgeRuntime.waitUntil`). Routes: `POST /calls/{call id}` and `POST /sweep`.
- **Queue on the call row.** calls-api sets `calls.followup_status = 'pending'` when a call ends and wakes the worker. The worker **claims** the call with a compare-and-set on status + attempts (`pending → running`, attempts + 1). A claim older than 5 minutes is stale and a sweep may take it back. After 30 attempts the call is marked `failed`.
- **Commit point.** The `followup_runs` row (unique per call) is written first. If it already exists, the job stops: the call was followed up. Everything after it (note, `followups` row, score, summary) is best effort: each step's failure is logged and the rest still runs. Notes are also unique per call.
- **Transcript wait.** If Sarvam's transcript is not ready, the worker releases the call with `followup_next_at = now + 15 s` and wakes itself after 30 s, for up to 10 minutes after the call ended. Then the summary is built from tool events alone. A missing interaction id is looked up by `call_token` in Sarvam's interaction list.
- **Rules first.** Code decides the clear cases: not answered, declined or ended before identity → try again; someone else answered → nothing shared; claim → owner confirms with [Confirm received] [Not received] (M4 claim cards); promise → check on the promise date; callback → "please call". Only **mixed signals** go to the agent: nothing agreed, hardship, a promise plus a dispute, or angry words.
- **Agent picks from a fixed list.** `sarvam-105b` (reasoning off), Gemini 2.5 Flash on failure. It returns one Zod-checked object: `remind_again` (date within 14 days), `owner_should_call` or `pause_reminders`, with a one-line reason. A bad or missing answer becomes `owner_should_call` (path `default`). It never writes.
- **Always a note.** One or two lines, from the transcript, by the LLM. With no transcript, no connection, or an LLM failure, the code writes a plain note from the facts. Asha reads it through `get_dues` as background, never as an instruction.
- **Summary** to the owner in the owner's language (`owners.language`), with the outcome, promise or claim, tone level, score and next step. Claim buttons only when a claim exists.
- **Score** is recalculated after each follow-up (SPEC §9, code only) and stored with its parts.

## Alternatives considered
1) Do the follow-up inside calls-api's `/ended`: one less function, but the phone page would wait on the LLM and the transcript, and a retry would repeat it.
2) Wait for 5b's pg_cron for everything: simpler, but the summary would arrive up to a minute late, and 5a would depend on 5b.
3) Let the LLM decide every call: one code path, but it costs more, is slower, and is harder to audit and test than rules for the clear cases.
4) Send the summary at once from tool events and drop the transcript: faster, but the note for the next call would be much weaker.

## Consequences
- One more function and one more secret (`WORKER_SECRET`, 32+ characters) to deploy.
- A summary arrives seconds to a few minutes after the call, depending on Sarvam's transcript.
- If a kick is lost, the call stays `pending` until a sweep runs (manual `POST /sweep` in 5a; pg_cron in 5b).
- Steps after the commit point are not retried: a failed send is logged, and the run is not repeated. A missed WhatsApp summary is visible in logs and, from M6, on the dashboard.
- `pause_reminders` rows are written in 5a and acted on by 5b's reminder queue.

## Addendum: reminder queue, simulated calls and scheduler (M5 half 5b, 2026-11-03)

### Decision
- **Queue on the `calls` table, limits in two places.** "Remind" and "Remind all" run the M3 pre-call check for every person (do-not-call, switchable hours and limits), then insert all calls in one write. The shopkeeper set for the phone page gets a `live` call: one at a time, the rest wait as `queued`. Everyone else gets a `simulated` call. "Remind all" skips anyone called in the last hour and anyone with reminders paused, and is capped at 10 people.
- **At most 4 simulated calls at once, enforced by the database.** `claim_simulated_call(max_running, stale_before)` takes an advisory lock, counts running simulated calls, and moves the oldest `queued` one to `in_progress`. Two worker runs can never both start a fifth. A run older than 5 minutes is treated as lost: the call is ended and followed up from its tool events.
- **One background run per simulated call.** The webhook (after Yes) wakes `followup-worker/simulations/next` once per free slot, up to 4. Each run claims one call, talks, saves the transcript, wakes the follow-up, then wakes `/simulations/next` again. The one-minute sweep also wakes it once, so a lost wake-up is picked up.
- **Simulator in text.** Asha's side uses her approved v3 prompt unchanged, plus a short text-mode section (draft), on `sarvam-105b`. Her tool calls go through the same `runTool` registry, identity gate and audit rows as live calls. The shopkeeper side is Gemini 2.5 Flash with a persona prompt (draft), falling back to `sarvam-105b`. The run stops at 10 turns, 3 tool steps per turn, a hang-up, or an unusable model answer. The call is `mode = 'simulated'` everywhere, then follows the same follow-up path as a live call.
- **Scheduler: pg_cron + pg_net** call `followup-worker` with `WORKER_SECRET` as a bearer token. The worker URL and the secret are in Supabase Vault, never in SQL. Jobs (UTC): `/sweep` every minute; `/promise-check` 03:15 (08:45 IST); `/daily-alert` 03:30 (09:00 IST). Content uses the demo-clock date.
- **Daily alert and WhatsApp's 24-hour rule.** One alert per owner per demo day (`owner_alerts`, unique). Inside the window the owner gets the full alert with Remind buttons; outside, only the approved utility template, whose "Reply DUE" opens the window.

### Alternatives considered
1) Count running simulations in the function: simpler, but two runs started together could both see 3 and start a fifth.
2) Run all simulated calls in one function run: fewer wake-ups, but 10 calls of 10 turns would pass the Edge Function time limit.
3) External scheduler (GitHub Actions, Vercel cron): no database extension, but another secret store and a less reliable one-minute schedule.
4) The same LLM for both sides: one key, but the two sides tend to mirror each other, which makes the test weaker.

### Consequences
- Two extensions (`pg_cron`, `pg_net`) and two Vault secrets on the hosted project.
- A simulated call costs about ₹1 (about 20 LLM requests). Gemini's free tier (about 10 requests a minute) can slow 4 parallel calls; the Sarvam fallback keeps them going.
- `whatsapp-webhook` now needs `WORKER_SECRET` too.
