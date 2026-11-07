# Architecture — Easy Recovery AI

Status: M6 built (2026-11-04, not yet deployed): voice notes in and out, English under Telugu (Sarvam Translate), insights with a ring chart, the web dashboard behind a signed link (ADR-0017). Before that, M5 built and deployed (2026-11-03), CP2 reviewed: 5a — memory and tone in `get_dues`, promise checker, reliability score, follow-up worker with WhatsApp summaries; 5b — due alert, Remind / Remind all with queue and limits, text simulated calls, pg_cron scheduler. On top of M4 (WhatsApp owner bot) and M3 (Sarvam voice agent, credit-book schema, phone page). Next: M7 (simulated-shopkeeper fix, evals + gate). **Planned (ADR-0018, proposed 2026-11-07):** Munshi, the owner's own voice agent. Updated by the `architect` agent when decisions change. Scope: `docs/SPEC.md` v2.0.

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
   │ [PLANNED, ADR-0018] menu "Call Munshi" → single-use signed /munshi link     ▲
   ▼                                                                             │
 Owner (Srinivas) — /munshi page ── calls-api proxy (Munshi app id) ──► Sarvam: Munshi
                                     Munshi tools ── owner secret + owner_call_token ──► munshi-tools ┘
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
| Munshi (Sarvam agent) — **planned** | Owner's voice line: male voice, Telugu first, answers about the book and prepares actions; never ends without "anything else?" (ADR-0018) | `voice-agents/munshi/` (planned) |
| `munshi-tools` — **planned** | Own bearer secret; `owner_call_token` → `owner_calls` row; reads; two-step writes (`prepare_*` → `confirm_action`), reversal for delete, `queueCall()` for Remind, background WhatsApp sends | `supabase/functions/munshi-tools/`, `_shared/owner-tools/` (planned) |
| `sarvam-tools` | Bearer-secret check; call token → call row; identity gate; 5 tools; audit row per call | `supabase/functions/sarvam-tools/` |
| `calls-api` | Demo ring, phone page (incoming/accept/decline/ended), Sarvam call-URL proxy | `supabase/functions/calls-api/` |
| `whatsapp-webhook` | Meta verify check, signature check, owner check, handle once, brain (commands → Sarvam LLM → Gemini), ledger replies, Save cards, claim confirm (ADR-0015) | `supabase/functions/whatsapp-webhook/`, `_shared/{whatsapp,brain,cards}/`, `_shared/ledger/{views,match,cleared}.ts` |
| `followup-worker` | After every call: transcript, rules or agent, note for Asha, `followups` row, score, WhatsApp summary; once per call (ADR-0016) | `supabase/functions/followup-worker/`, `_shared/followup/`, `_shared/sarvam-analytics.ts` |
| Reminders + simulator | Due alert, Remind / Remind all with queue and limits, daily alert (template outside 24 h), daily promise check, score explain; text simulated calls (Asha on Sarvam vs persona on Gemini) | `_shared/reminders/`, `_shared/calls/queue.ts`, `_shared/simulator/`, `followup-worker` job routes, pg_cron migration |
| Memory, tone, score | Promise checker (demo clock), last promise and rejected claim, history of the last 3 calls (M7 B1, code-built; the LLM note is the owner's only), tone level 1–3, reliability score with parts; all plain code | `_shared/ledger/{promise-check,score,history}.ts`, `_shared/calls/{memory,tone,call-history,call-history-asha,their-words}.ts` |
| Shared core | Env, errors, Zod schemas, dues maths, promise/claim rules, `queueCall`, database client (ADR-0010), JSON LLM client (Sarvam → Gemini), bearer check | `supabase/functions/_shared/` |
| Database | Owner, shopkeepers, ledger, promises, calls, audit, notes, follow-ups, evals, publishes | `supabase/migrations/` |
| Web | `/` dashboard (KPIs, ring chart, top 5, recent calls, demo controls) · `/shopkeepers` · `/calls` (behind the signed link) · `/phone` shopkeeper phone | `web/` |
| Seed | Deterministic generator: 1 owner, 100 shopkeepers, ~6 months of credit | `scripts/seed/` → `supabase/seed.sql` |

## One call, end to end

1. **Ring.** `/` "Ring Ramesh" → `POST /v1/demo/ring` → `queueCall()` (rate limit, do-not-call, calling hours and attempt limits when switched on, ADR-0011) → `calls` row `queued`. M4's WhatsApp Remind uses the same function.
2. **Phone rings.** `/phone` polls `GET /v1/phone/incoming` every 2 s; the first poll marks the call `ringing`. No answer in 30 s → `missed`; Decline → `declined`.
3. **Accept.** `POST /v1/calls/{token}/accept` (only from `ringing`) → `accepted`, returns names, language, India "today" and the Sarvam org/workspace/app ids. The token is the `calls.id` (ADR-0009).
4. **Call URL.** On the Accept click the Sarvam SDK requests `…/v1/sarvam/orgs/{org}/workspaces/{ws}/apps/{app}/url` with `x-call-token`. The proxy allows only our ids, only an `accepted` token within 2 minutes, once (→ `in_progress`), and adds `SARVAM_AGENTS_API_KEY` server-side. Sarvam's `{url, reference_id, expires_at}` is passed through.
5. **Talk.** The SDK sends agent variables (`call_token`, never spoken; names; today) and the greeting in the shopkeeper's language. Asha calls tools; each request carries `call_token` and our bearer secret.
6. **Tools.** `sarvam-tools` checks the secret (401 otherwise), loads the call by token, and refuses unless the call is `accepted`/`in_progress` and within 10 minutes of accept. `confirm_identity` must say "confirmed" before any amount is shared (ADR-0005). Every reply is HTTP 200 `{ok, say, …data}`; refusals carry no figures. One audit row per tool call.
7. **Hang up.** The page stops the SDK and posts `…/ended {interactionId, seconds}` → `completed`; tools stop working for that token. Completed, declined and missed calls get `followup_status = 'pending'` and calls-api wakes `followup-worker` (below).

In step 6, `get_dues` (after identity only) first runs the **promise checker** on the demo-clock date (kept if paid in full by the date + 1 grace day, broken after it; written back with a compare-and-set), then works out the **tone level** in code (1 friendly; 2 firm: 1 broken promise in 6 months or 15+ days overdue; 3 firmer: 2+ broken or 30+ days) and the **memory** (last promise and its result, a payment the owner rejected in the last 30 days, and since M7 B1 the **history of the last 3 calls**: outcome, promise terms and result, claim, fixed callback reasons, "was upset", and at most one sanitised, number-free phrase of the shopkeeper's own words labelled as their claim; read in the same parallel round, one PostgREST request with embedded rows; the LLM-written follow-up note never reaches Asha, CP2 M2). All of it is written into the tool's `say` text, because Sarvam passes only `say` to the LLM. The level is stored on the call.

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
3. **Live or simulated.** A one-person Remind (button, pick list or "remind <name>") is always `live` for any shopkeeper: it rings `/phone`, one at a time, oldest first; while a live call is accepted or in progress (at most 5 minutes) the next waits as `queued` (Live remind, pre-M6). "Remind all" is always `simulated`, and the webhook wakes `followup-worker/simulations/next` once per free slot (max 4). `demo_settings.live_shopkeeper_id` now only picks who the dashboard's "Ring" button calls.
4. **Simulated call.** `claim_simulated_call` (DB, advisory lock: max 4 running) → Asha (v3 + text-mode section, `sarvam-105b`) talks to the shopkeeper persona (Gemini → Sarvam), ≤10 turns. Asha's tools go through the same registry, identity gate and audit rows. The transcript is saved, the call is completed, the follow-up runs exactly as for a live call, and the run wakes the next simulation.
5. **Scheduler.** pg_cron → `call_followup_worker(route)` → pg_net POST with `WORKER_SECRET` from Vault: `/sweep` every minute (follow-ups due, lost wake-ups, next simulation; stale runs over 5 minutes ended); `/promise-check` 08:45 IST; `/daily-alert` 09:00 IST. Each owner message also wakes `/sweep`.

## One owner message, end to end (M4)

1. **Meta → webhook.** Meta POSTs the message to `whatsapp-webhook`, signed with the App Secret. Wrong signature → 401. Otherwise 200 at once; the rest runs in the background (`EdgeRuntime.waitUntil`).
2. **Who.** The sender is compared with `OWNER_WHATSAPP_NUMBER` (function secret). A stranger gets one "not registered" reply a day and nothing else happens. Rows keep a keyed hash of the sender, never the number or the text.
3. **Once.** The Meta message id goes into `wa_messages` (unique); a retry stops here.
4. **Understand.** Button tap → card action. Text → fixed command in code (`brain/commands.ts`: pending, closed, a name, "X paid N", "X N due D", in English and Latin-letter Hindi/Telugu). Anything else → Sarvam `sarvam-105b` (8 s, reasoning off) → Gemini 2.5 Flash → "Sorry" + help. The LLM returns one Zod-checked suggestion and never writes.
5. **Answer.** Reads (pending, closed, one shopkeeper) come from the ledger on the demo-clock date. Changes become a card in `pending_actions` (30 minutes): [Save] [Edit] [Cancel], a pick list for unclear names, or "Add as a new shopkeeper?". Save writes one confirmed entry (compare-and-set on the card). Asha's payment claims are settled with [Confirm received] [Not received].
6. **Reply** through the Cloud API in the language of the owner's message (phrase table; figures in digits). The path that answered (button, command, sarvam, gemini, failed) is stored for M7's evals.

## Voice notes, translation and the dashboard (M6, ADR-0017)

1. **Voice in.** Meta "audio" → `whatsapp/media.ts` downloads it (our token, 1 MB max) → `audio/ogg.ts` reads its length (30 s max) → daily cap (50, `wa_messages`) → Saaras `saaras:v3` codemix (`speech/stt.ts`) → the same brain as text, in the detected language → replies start with "🎤 Heard: …". Nothing about the audio is stored.
2. **Voice out.** After a heard note: text first, then `whatsapp/spoken.ts` (short spoken version) → Bulbul v3 Kavitha MP3 (`speech/tts.ts`) → Meta upload → audio message. Best effort, 50 a day.
3. **English under Telugu.** `whatsapp/english-twin.ts` wraps the WhatsApp sender in both functions: when `owners.english_under_telugu` is on, every Telugu message gets its English from Sarvam Translate (`speech/translate.ts`: names and figures masked, any lost marker → Telugu alone).
4. **Insights.** "insights"/"report" → `ledger/insights.ts` (this month's split, % collected, week change, outstanding, top 5) → `charts/pie.ts` draws the ring PNG → Meta upload → image with caption + text + dashboard link.
5. **Dashboard.** The bot signs a 24-hour link (`auth/dashboard-link.ts`). The page sends the token as `x-dashboard-token` to `calls-api/dashboard-routes.ts` (401 without it): overview, shopkeepers, one shopkeeper (score parts, entries, promises, notes, calls), calls, one call (transcript with English made once and kept in `calls.transcript_en`, tool calls, follow-up decision, cost), and the English-under-Telugu switch.

## Spoken summary, Menu and next-step buttons (M7 Build A)

1. **Spoken summary.** After a heard voice note, `whatsapp/spoken-summary.ts` asks `sarvam-105b` (Sarvam only, temperature 0.7, 400 tokens, reasoning off, 8 s cap; prompt v1 in `whatsapp/spoken-prompt.ts` with a code-picked opening) for `{"say": …}`. `whatsapp/spoken-check.ts` checks it against the reply text and button titles: length ≤ 600, no link, right script, every number in the reply, no amounts in words, no name that is not in the reply. Any failure, error or timeout → today's `spokenText`. Logged as `spoken_summary` (outcome, reason, ms, prompt version), never the text.
2. **Menu.** Greetings, "menu", "help" and the LLM's help intent → one list message (`whatsapp/menu.ts`, 8 rows); "Sorry, I didn't get that" comes with it. Rows are `mn:<item>:<lang>` taps that run the same command as typing it (`whatsapp-webhook/taps.ts` → `run-command.ts`).
3. **Next-step buttons.** A lookup ends with "What next for Ramesh?" [Remind] (`rm:`, one call with all pre-call checks) [Paid in full] (`pf:`, a payment card for his outstanding worked out at tap time; nothing saved before Save) [Part payment] (`pp:`, a hint). "pending" adds an "Open a shopkeeper" list (`lk:` rows); Save adds [Pending] [Menu]; insights adds [Due today] [Menu]. Ids carry a database id, never an amount.
4. **Bot profile.** `npm run bot:profile` (laptop only, `scripts/lib/bot-profile.ts`) uploads `web/public/brand/logo-640.png` (rendered from `logo.svg` by `npm run brand:png`, `@resvg/resvg-js` devDependency) and sets About, description, category and website on the Meta test number.

## Munshi, the owner's call (planned, ADR-0018 — proposed, not built)

1. **Start.** Menu row "📞 Call Munshi" → webhook creates an `owner_calls` row (15 min) and sends a single-use `/munshi#t=<id>.<HMAC>` link (`MUNSHI_LINK_SECRET`). The page accepts it (compare-and-set); the calls-api proxy issues one Sarvam URL for Munshi's app id only. Shared daily cap of 20 live sessions with Asha.
2. **Talk.** Munshi's tools POST `{owner_call_token, …args}` to `munshi-tools` with the owner tool secret. Reads (`book_summary`, `lookup_shopkeeper`) answer in one call with a ready `say`, facts from records (incl. Asha's last call via the M7 B1 history).
3. **Act.** `prepare_credit | prepare_payment | prepare_delete | prepare_remind | prepare_send` → one `pending_actions` row for this call + read-back. `confirm_action` runs only the latest open action, unexpired, ≥ 2 s after its prepare, by compare-and-set; then the same ledger / `queueCall()` code as WhatsApp. Delete writes a `reversal` row; nothing is hard-deleted.
4. **After.** An active owner call holds the live line, so a queued Asha call rings `/phone` after Munshi hangs up; the follow-up worker then sends the WhatsApp summary. Requested WhatsApp sends go out in the background with the existing reply builders.

## Data model

`supabase/migrations/20261103000001_easy_recovery_schema.sql` (SPEC §13): `owners`, `shopkeepers` (score columns filled by the promise check since M5), `ledger_entries` (credit/payment; confirmed/claimed/rejected), `promises` (open/kept/broken/replaced, one per call), `calls`, `tool_events`, `shopkeeper_notes`, `followup_runs`, `followups`, `eval_runs`, `eval_results`, `publishes`, `demo_settings`, view `balances`. M4 adds `wa_messages` (message ids, direction, type, path, command, sender hash) and `pending_actions` (cards), in `20261104000001_whatsapp.sql`. M5 adds the follow-up queue on `calls` (`followup_status`, `followup_attempts`, `followup_next_at`, `followup_claimed_at`), one run and one note per call (unique indexes), and the `pause_reminders` follow-up kind, in `20261105000001_followup.sql`. M5 5b adds `owner_alerts` (one daily alert per owner per demo day), the "call these people?" card kind, the simulated-call queue index, `claim_simulated_call` and the pg_cron jobs (`call_followup_worker`), in `20261106000001_reminders.sql`. M6 adds `owners.english_under_telugu` and `calls.transcript_en` (`20261107000001`, `20261107000002`). Dues and days overdue are computed in code (`_shared/ledger/dues.ts`), oldest credit paid first, so the demo clock applies.

## Security boundaries

- The browser holds only the Supabase anon key. The Sarvam keys and tool secret live only in function secrets and `.env`; the bundle scan fails the build if any appears in `web/dist`.
- RLS is on for every table with **no** policies; functions use the service role.
- `sarvam-tools` runs without Supabase JWT checks (Sarvam can't send one) and checks its own bearer secret (constant-time compare). Who the call is about comes only from the call token, never from the LLM.
- The proxy is not open: fixed upstream host, our own org/workspace/app only, one URL per accepted token, 2-minute window. One token = at most one billed Sarvam session (capped at 4 minutes).
- `calls-api` needs only the anon key (prototype, no login): CORS allowlist and a ring rate limit (3 a minute per shopkeeper) limit abuse.
- `whatsapp-webhook` runs without Supabase JWT checks (Meta can't send one) and checks Meta's HMAC signature on the raw body. Only the owner's number (a function secret) is answered; the number never reaches the database or logs (ADR-0015).
- `followup-worker` runs without Supabase JWT checks (calls-api and pg_cron can't send a user JWT) and checks `WORKER_SECRET` (32+ characters, constant-time compare) before reading anything. The Sarvam Analytics key and the owner's number stay in function secrets; the LLM only suggests a next step from a fixed list and never writes (ADR-0016).
- pg_cron reads the worker URL and `WORKER_SECRET` from Supabase Vault; neither is in a migration or a cron command. `claim_simulated_call` and `call_followup_worker` are revoked from `anon` and `authenticated`. In a simulated call the persona never sees tool replies; Asha's tools keep the identity gate and audit rows.
- **Planned (ADR-0018):** owner and shopkeeper tool scopes are split three ways — separate function (`munshi-tools`), separate bearer secret, separate token table (`owner_calls` vs `calls`). Money changes by voice only through `confirm_action` on a prepared, read-back action; the prompt is not the lock.
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
| [0017](adr/ADR-0017-voice-notes-translate-dashboard-link.md) | Voice notes through the text path; live Sarvam Translate with masked names/figures; chart drawn in code; dashboard behind a signed 24-hour link |
| [0018](adr/ADR-0018-munshi-owner-voice-agent.md) | **Proposed:** Munshi owner voice agent — own `munshi-tools` function and secret, single-use owner-call link, two-step confirm in code, delete as reversal |
