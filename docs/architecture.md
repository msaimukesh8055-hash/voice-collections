# Architecture — Easy Recovery AI

Status: M5 half 5a built (2026-11-03): memory and tone in `get_dues`, promise checker, reliability score, follow-up worker with WhatsApp summaries, on top of M4 (WhatsApp owner bot) and M3 (Sarvam voice agent, credit-book schema, phone page). Updated by the `architect` agent when decisions change. Scope: `docs/SPEC.md` v2.0.

## System context

```
 Shopkeeper (Ramesh) — /phone page in Chrome (mic)
   │ 1. polls calls-api, rings, Accept (anon key)
   │ 2. Sarvam SDK asks calls-api proxy for a call URL (x-call-token; no Sarvam key in browser)
   │ 3. audio over Sarvam's signed WebSocket URL
   ▼
 ┌─────────────────────────┐  tool POSTs {call_token, …args}   ┌──────────────────────────────┐
 │ Sarvam Voice Agents     │  Bearer <tool secret>             │ Supabase Edge Functions      │
 │ (Azure India)           │ ────────────────────────────────► │ (Mumbai, ap-south-1)         │
 │ Asha: Saaras STT ·      │ ◄──────────────────────────────── │ sarvam-tools: 5 tools,       │
 │ LLM · Bulbul TTS        │   {ok, say, …data} → "{{say}}"    │   identity gate, rules, audit│
 └─────────────────────────┘                                   │ calls-api: demo ring, phone  │
   ▲ agent config as code (voice-agents/asha)                  │   page steps, Sarvam proxy   │
   │ npm run agent:build → JSON → pushed with Sarvam MCP       └──────────────┬───────────────┘
                                                                              │ service role
 Owner dashboard (/) — "Ring" demo button (M3); full dashboard M6             ▼
 WhatsApp owner bot (M4) ── whatsapp-webhook (below) ──►         Postgres (RLS on, no policies)
                                                                              ▲
 calls-api /ended ── Bearer WORKER_SECRET ──► followup-worker (M5) ───────────┘
                                               │ Sarvam Analytics: transcript (X-API-Key)
                                               │ sarvam-105b → Gemini: next step + note
                                               └ WhatsApp Cloud API: summary to the owner
```

## Components

| Component | Responsibility | Location |
|---|---|---|
| Asha (Sarvam agent) | Live voice in Telugu/Hindi/English; prompt, greeting, voice, tools kept as code (ADR-0012) | `voice-agents/asha/` → `npm run agent:build` |
| `sarvam-tools` | Bearer-secret check; call token → call row; identity gate; 5 tools; audit row per call | `supabase/functions/sarvam-tools/` |
| `calls-api` | Demo ring, phone page (incoming/accept/decline/ended), Sarvam call-URL proxy | `supabase/functions/calls-api/` |
| `whatsapp-webhook` | Meta verify check, signature check, owner check, handle once, brain (commands → Sarvam LLM → Gemini), ledger replies, Save cards, claim confirm (ADR-0015) | `supabase/functions/whatsapp-webhook/`, `_shared/{whatsapp,brain,cards}/`, `_shared/ledger/{views,match,cleared}.ts` |
| `followup-worker` | After every call: transcript, rules or agent, note for Asha, `followups` row, score, WhatsApp summary; once per call (ADR-0016) | `supabase/functions/followup-worker/`, `_shared/followup/`, `_shared/sarvam-analytics.ts` |
| Reminders + simulator | Due alert, Remind / Remind all with queue and limits, daily alert (template outside 24 h), daily promise check, score explain; text simulated calls (Asha on Sarvam vs persona on Gemini) | `_shared/reminders/`, `_shared/calls/queue.ts`, `_shared/simulator/`, `followup-worker` job routes, pg_cron migration |
| Memory, tone, score | Promise checker (demo clock), last promise/note/rejected claim, tone level 1–3, reliability score with parts; all plain code | `_shared/ledger/{promise-check,score,history}.ts`, `_shared/calls/{memory,tone}.ts` |
| Shared core | Env, errors, Zod schemas, dues maths, promise/claim rules, `queueCall`, database client (ADR-0010), JSON LLM client (Sarvam → Gemini), bearer check | `supabase/functions/_shared/` |
| Database | Owner, shopkeepers, ledger, promises, calls, audit, notes, follow-ups, evals, publishes | `supabase/migrations/` |
| Web | `/` demo controls (dashboard in M6) · `/phone` shopkeeper phone | `web/` |
| Seed | Deterministic generator: 1 owner, 100 shopkeepers, ~6 months of credit | `scripts/seed/` → `supabase/seed.sql` |

## One call, end to end

1. **Ring.** `/` "Ring Ramesh" → `POST /v1/demo/ring` → `queueCall()` (rate limit, do-not-call, calling hours and attempt limits when switched on, ADR-0011) → `calls` row `queued`. M4's WhatsApp Remind uses the same function.
2. **Phone rings.** `/phone` polls `GET /v1/phone/incoming` every 2 s; the first poll marks the call `ringing`. No answer in 30 s → `missed`; Decline → `declined`.
3. **Accept.** `POST /v1/calls/{token}/accept` (only from `ringing`) → `accepted`, returns names, language, India "today" and the Sarvam org/workspace/app ids. The token is the `calls.id` (ADR-0009).
4. **Call URL.** On the Accept click the Sarvam SDK requests `…/v1/sarvam/orgs/{org}/workspaces/{ws}/apps/{app}/url` with `x-call-token`. The proxy allows only our ids, only an `accepted` token within 2 minutes, once (→ `in_progress`), and adds `SARVAM_AGENTS_API_KEY` server-side. Sarvam's `{url, reference_id, expires_at}` is passed through.
5. **Talk.** The SDK sends agent variables (`call_token`, never spoken; names; today) and the greeting in the shopkeeper's language. Asha calls tools; each request carries `call_token` and our bearer secret.
6. **Tools.** `sarvam-tools` checks the secret (401 otherwise), loads the call by token, and refuses unless the call is `accepted`/`in_progress` and within 10 minutes of accept. `confirm_identity` must say "confirmed" before any amount is shared (ADR-0005). Every reply is HTTP 200 `{ok, say, …data}`; refusals carry no figures. One audit row per tool call.
7. **Hang up.** The page stops the SDK and posts `…/ended {interactionId, seconds}` → `completed`; tools stop working for that token. Completed, declined and missed calls get `followup_status = 'pending'` and calls-api wakes `followup-worker` (below).

In step 6, `get_dues` (after identity only) first runs the **promise checker** on the demo-clock date (kept if paid in full by the date + 1 grace day, broken after it; written back with a compare-and-set), then works out the **tone level** in code (1 friendly; 2 firm: 1 broken promise in 6 months or 15+ days overdue; 3 firmer: 2+ broken or 30+ days) and the **memory** (last promise and its result, last call note, a payment the owner rejected in the last 30 days). All of it is written into the tool's `say` text, because Sarvam passes only `say` to the LLM. The level is stored on the call.

## After a call (M5, ADR-0016)

1. **Wake.** calls-api posts `/followup-worker/calls/{id}` with `WORKER_SECRET` in the background; the worker answers 202 and works in the background.
2. **Claim.** Compare-and-set `pending → running` (attempts + 1). Anything else, or a claim under 5 minutes old, is skipped.
3. **Transcript.** Sarvam Analytics `GET …/transcripts/{interaction_id}`; a missing id is found by `call_token` in `GET …/interactions`. Not ready → release for 15 s and wake again after 30 s, for up to 10 minutes; then carry on from tool events alone.
4. **Facts.** Call status, identity result, promise, claim and callbacks from `tool_events`, plus ledger, promises and owner.
5. **Decide.** Rules for clear cases; mixed signals (nothing agreed, hardship, promise + dispute, angry words) → agent (`sarvam-105b` → Gemini → default "owner should call"). A note for Asha is written at the same time (LLM, or a plain code note).
6. **Commit.** Insert `followup_runs` (unique per call). Already there → stop.
7. **Finish (best effort, each step logged).** Note, `followups` row (promise check, owner callback, remind again, claim confirm, pause reminders), score with parts, WhatsApp summary in the owner's language with claim buttons when needed, then the call is marked `done`.

## Reminders, simulated calls and the scheduler (M5 5b, ADR-0016 addendum)

1. **Due alert.** "who is due?" / "due", or pg_cron at 09:00 IST → `/daily-alert`. The promise checker runs first, then `buildDueAlert` lists broken promises (last 14 days), overdue and due today on the demo-clock date. Inside WhatsApp's 24-hour window: the alert + [Remind] buttons (≤3) or a list (≤10) + [Remind all due]. Outside: the `daily_due_alert` template only. Once per owner per demo day (`owner_alerts`).
2. **Remind.** One person → `queueCall()` (M3 pre-call check). **Remind all** → a `remind_all` card "Call N people? (1 called in the last hour, skipped)" [Yes] [No]; Yes → compare-and-set on the card → `queueReminders()` (pre-call check per person, one bulk insert, max 10).
3. **Live or simulated.** The phone page's shopkeeper gets a `live` call (rings `/phone`, one at a time). Everyone else gets `simulated`, and the webhook wakes `followup-worker/simulations/next` once per free slot (max 4).
4. **Simulated call.** `claim_simulated_call` (DB, advisory lock: max 4 running) → Asha (v3 + text-mode section, `sarvam-105b`) talks to the shopkeeper persona (Gemini → Sarvam), ≤10 turns. Asha's tools go through the same registry, identity gate and audit rows. The transcript is saved, the call is completed, the follow-up runs exactly as for a live call, and the run wakes the next simulation.
5. **Scheduler.** pg_cron → `call_followup_worker(route)` → pg_net POST with `WORKER_SECRET` from Vault: `/sweep` every minute (follow-ups due, lost wake-ups, next simulation; stale runs over 5 minutes ended); `/promise-check` 08:45 IST; `/daily-alert` 09:00 IST. Each owner message also wakes `/sweep`.

## One owner message, end to end (M4)

1. **Meta → webhook.** Meta POSTs the message to `whatsapp-webhook`, signed with the App Secret. Wrong signature → 401. Otherwise 200 at once; the rest runs in the background (`EdgeRuntime.waitUntil`).
2. **Who.** The sender is compared with `OWNER_WHATSAPP_NUMBER` (function secret). A stranger gets one "not registered" reply a day and nothing else happens. Rows keep a keyed hash of the sender, never the number or the text.
3. **Once.** The Meta message id goes into `wa_messages` (unique); a retry stops here.
4. **Understand.** Button tap → card action. Text → fixed command in code (`brain/commands.ts`: pending, closed, a name, "X paid N", "X N due D", in English and Latin-letter Hindi/Telugu). Anything else → Sarvam `sarvam-105b` (8 s, reasoning off) → Gemini 2.5 Flash → "Sorry" + help. The LLM returns one Zod-checked suggestion and never writes.
5. **Answer.** Reads (pending, closed, one shopkeeper) come from the ledger on the demo-clock date. Changes become a card in `pending_actions` (30 minutes): [Save] [Edit] [Cancel], a pick list for unclear names, or "Add as a new shopkeeper?". Save writes one confirmed entry (compare-and-set on the card). Asha's payment claims are settled with [Confirm received] [Not received].
6. **Reply** through the Cloud API in the language of the owner's message (phrase table; figures in digits). The path that answered (button, command, sarvam, gemini, failed) is stored for M7's evals.

## Data model

`supabase/migrations/20261103000001_easy_recovery_schema.sql` (SPEC §13): `owners`, `shopkeepers` (score columns empty until M5), `ledger_entries` (credit/payment; confirmed/claimed/rejected), `promises` (open/kept/broken/replaced, one per call), `calls`, `tool_events`, `shopkeeper_notes`, `followup_runs`, `followups`, `eval_runs`, `eval_results`, `publishes`, `demo_settings`, view `balances`. M4 adds `wa_messages` (message ids, direction, type, path, command, sender hash) and `pending_actions` (cards), in `20261104000001_whatsapp.sql`. M5 adds the follow-up queue on `calls` (`followup_status`, `followup_attempts`, `followup_next_at`, `followup_claimed_at`), one run and one note per call (unique indexes), and the `pause_reminders` follow-up kind, in `20261105000001_followup.sql`. Dues and days overdue are computed in code (`_shared/ledger/dues.ts`), oldest credit paid first, so the demo clock applies.

## Security boundaries

- The browser holds only the Supabase anon key. The Sarvam keys and tool secret live only in function secrets and `.env`; the bundle scan fails the build if any appears in `web/dist`.
- RLS is on for every table with **no** policies; functions use the service role.
- `sarvam-tools` runs without Supabase JWT checks (Sarvam can't send one) and checks its own bearer secret (constant-time compare). Who the call is about comes only from the call token, never from the LLM.
- The proxy is not open: fixed upstream host, our own org/workspace/app only, one URL per accepted token, 2-minute window. One token = at most one billed Sarvam session (capped at 4 minutes).
- `calls-api` needs only the anon key (prototype, no login): CORS allowlist and a ring rate limit (3 a minute per shopkeeper) limit abuse.
- `whatsapp-webhook` runs without Supabase JWT checks (Meta can't send one) and checks Meta's HMAC signature on the raw body. Only the owner's number (a function secret) is answered; the number never reaches the database or logs (ADR-0015).
- `followup-worker` runs without Supabase JWT checks (calls-api and pg_cron can't send a user JWT) and checks `WORKER_SECRET` (32+ characters, constant-time compare) before reading anything. The Sarvam Analytics key and the owner's number stay in function secrets; the LLM only suggests a next step from a fixed list and never writes (ADR-0016).
- pg_cron reads the worker URL and `WORKER_SECRET` from Supabase Vault; neither is in a migration or a cron command. `claim_simulated_call` and `call_followup_worker` are revoked from `anon` and `authenticated`. In a simulated call the persona never sees tool replies; Asha's tools keep the identity gate and audit rows.
- Database and functions in **Mumbai**, next to Sarvam (Azure India) — fast tool calls and data kept in India (ADR-0008).

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](adr/ADR-0001-vapi-browser-web-calls.md) | ~~Vapi browser web calls~~ — superseded by 0012 |
| [0002](adr/ADR-0002-single-webhook-tool-registry.md) | Single tool endpoint + typed tool registry |
| [0003](adr/ADR-0003-supabase-cloud-only.md) | Supabase cloud only; no local Docker stack |
| [0004](adr/ADR-0004-gemini-free-tier.md) | Gemini free tier — now eval judge and fallback only (see 0014) |
| [0005](adr/ADR-0005-verify-before-disclose-in-code.md) | Identity confirmed before disclosure, enforced in code (amended M3) |
| [0006](adr/ADR-0006-live-agent-plus-followup-agent.md) | One live voice agent + follow-up agent; rules before agent |
| [0007](adr/ADR-0007-voice-stack.md) | ~~Vapi voice stack~~ — superseded by 0012 |
| [0008](adr/ADR-0008-server-region-next-to-vapi.md) | Database and functions next to the voice platform — Mumbai since M3 |
| [0009](adr/ADR-0009-call-token-identity.md) | One-time call token tells the server who the call is about (lock by call state since M3) |
| [0010](adr/ADR-0010-database-http-client.md) | Small HTTP database client in functions instead of supabase-js |
| [0011](adr/ADR-0011-compliance-switches-for-testing.md) | Calling hours and attempt limits switchable off for testing |
| [0012](adr/ADR-0012-sarvam-voice-agents.md) | Sarvam Voice Agents replace Vapi; browser calls through a key proxy |
| [0013](adr/ADR-0013-whatsapp-first-owner.md) | WhatsApp is the owner's main interface; dashboard is secondary |
| [0014](adr/ADR-0014-sarvam-llm-code-first-commands.md) | Sarvam LLM as the brain; fixed commands parsed in code first |
| [0015](adr/ADR-0015-whatsapp-webhook-and-cards.md) | WhatsApp webhook: signature, owner only, handle once, background work; Save cards for every change |
| [0016](adr/ADR-0016-followup-agent.md) | Follow-up worker: rules first, agent for mixed signals, once per call, transcript wait |
