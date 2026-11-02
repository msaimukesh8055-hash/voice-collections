# Architecture — Easy Recovery AI

Status: M3 built (2026-11-02): Sarvam voice agent, credit-book schema, phone page. Updated by the `architect` agent when decisions change. Scope: `docs/SPEC.md` v2.0.

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
 WhatsApp owner bot (M4) ── same queueCall() path ──►            Postgres (RLS on, no policies)
```

## Components

| Component | Responsibility | Location |
|---|---|---|
| Asha (Sarvam agent) | Live voice in Telugu/Hindi/English; prompt, greeting, voice, tools kept as code (ADR-0012) | `voice-agents/asha/` → `npm run agent:build` |
| `sarvam-tools` | Bearer-secret check; call token → call row; identity gate; 5 tools; audit row per call | `supabase/functions/sarvam-tools/` |
| `calls-api` | Demo ring, phone page (incoming/accept/decline/ended), Sarvam call-URL proxy | `supabase/functions/calls-api/` |
| Shared core | Env, errors, Zod schemas, dues maths, promise/claim rules, `queueCall`, database client (ADR-0010) | `supabase/functions/_shared/` |
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
7. **Hang up.** The page stops the SDK and posts `…/ended {interactionId, seconds}` → `completed`; tools stop working for that token. M5 adds transcript fetch, cost, notes and the follow-up agent.

## Data model

`supabase/migrations/20261103000001_easy_recovery_schema.sql` (SPEC §13): `owners`, `shopkeepers` (score columns empty until M5), `ledger_entries` (credit/payment; confirmed/claimed/rejected), `promises` (open/kept/broken/replaced, one per call), `calls`, `tool_events`, `shopkeeper_notes`, `followup_runs`, `followups`, `eval_runs`, `eval_results`, `publishes`, `demo_settings`, view `balances`. Dues and days overdue are computed in code (`_shared/ledger/dues.ts`), oldest credit paid first, so the demo clock applies.

## Security boundaries

- The browser holds only the Supabase anon key. The Sarvam keys and tool secret live only in function secrets and `.env`; the bundle scan fails the build if any appears in `web/dist`.
- RLS is on for every table with **no** policies; functions use the service role.
- `sarvam-tools` runs without Supabase JWT checks (Sarvam can't send one) and checks its own bearer secret (constant-time compare). Who the call is about comes only from the call token, never from the LLM.
- The proxy is not open: fixed upstream host, our own org/workspace/app only, one URL per accepted token, 2-minute window. One token = at most one billed Sarvam session (capped at 4 minutes).
- `calls-api` needs only the anon key (prototype, no login): CORS allowlist and a ring rate limit (3 a minute per shopkeeper) limit abuse.
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
