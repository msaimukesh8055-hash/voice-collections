# Architecture — Suvidha Finance Voice AI

Status: M2 done, CP1 fixes applied (2026-11-02). Updated by the `architect` agent when decisions change.

## System context

```
 Borrower (browser mic)
        │  WebRTC (Vapi Web SDK, public key)
        ▼
 ┌──────────────┐   tool calls + end-of-call report   ┌───────────────────────────────┐
 │     Vapi     │ ──────────────────────────────────► │ Supabase Edge Function         │
 │ ASR · LLM ·  │ ◄────────────────────────────────── │ vapi-webhook (secret-verified) │
 │ TTS · barge-in│        tool results                │  ├ tool registry               │
 └──────────────┘                                     │  ├ compliance engine           │
        ▲                                             │  ├ post-call: summary,         │
        │ agent config (as code, release-gated)       │  │   compliance check          │
        │                                             │  └ follow-up agent (rules →    │
 voice-agents/<use-case>/ ── npm run agent:push ──►   │      agent, guarded tools)     │
                                                      └───────────────┬───────────────┘
 Dashboard (Vite/React, light-blue)                                   │ service role
   │ HTTPS (anon key) → calls-api Edge Function ──────────────────────┤
   ▼                                                                  ▼
 Saim / collections manager                         Postgres + pgvector (RLS on all tables)
                                                                      ▲
 Gemini (free tier): summary · compliance AI check ·                 │
 follow-up judgement · embeddings · eval simulator + judge ───────────┘ (server-side only)
```

## Components

| Component | Responsibility | Location |
|---|---|---|
| Vapi assistant | Live voice: Deepgram speech-to-text, Vapi-hosted `gpt-4.1-mini`, Azure Indian voices, interruptions (ADR-0007) | Config in `voice-agents/collections/` |
| `vapi-webhook` | Verify Vapi secret; dispatch tool calls; record audit; run post-call steps and follow-up agent | `supabase/functions/vapi-webhook/` |
| `calls-api` | REST read/write API for the dashboard (`/v1/...`); demo controls | `supabase/functions/calls-api/` |
| Shared core | Env, errors, Zod schemas, compliance rules, tool registry, database client (ADR-0010), follow-up rules | `supabase/functions/_shared/` |
| Database | Fake core banking, call audit, follow-ups, notes, knowledge chunks, evals | `supabase/migrations/` |
| Dashboard | KPIs, customers, simulator, calls, follow-ups, human queue, evals | `web/` |
| Evals | Simulated conversations, judge, release gate | `evals/` |

## One call, end to end

1. Dashboard → `calls-api` `POST /v1/calls/authorize`: rate limit, then the pre-call rules (do-not-call always; calling hours and attempt limits when switched on, ADR-0011) → a `calls` row is created and its id returned as a one-time **call token**, with the customer's name, language and India "today".
2. Browser starts a Vapi web call in the customer's language with the token in `assistantOverrides.metadata`. The agent greets with the AI disclosure, then gives the recording notice once the person is confirmed.
3. Agent calls tools → `vapi-webhook` checks the shared secret, then finds the customer **from the call token** (locked to the first Vapi call, ADR-0009), never from the LLM. Arguments are validated with Zod, verify-before-disclose is enforced (2 DOB attempts a call, 6 failed a day per customer), and every tool call writes a `tool_events` row holding only schema-checked arguments (DOB always redacted). A tool that hits a database error returns a safe "share no figures, offer a callback" result instead of failing the request.
4. Call ends → Vapi end-of-call report → transcript saved → summary → compliance check → follow-up agent.
5. Follow-up agent: rules decide clear cases; agent decides judgement calls; guarded tools act; a note is always written.
6. Next call → `lookup_loan` returns the latest note and last promise.

## Data model

See `supabase/migrations/20261031000001_schema.sql` (SPEC §10). Lead-qualification tables are deferred until that scope is approved.

## Security boundaries

- Browser holds only the Supabase anon key and the Vapi public key.
- RLS is enabled on every table with **no** anon/authenticated policies — the browser cannot read data directly; Edge Functions use the service role server-side.
- Vapi → webhook requests must carry the shared secret; the customer comes only from the call token.
- `calls-api` needs only the public anon key (prototype, no login): a per-customer rate limit (3 authorisations a minute) and a CORS allowlist limit abuse.
- Gemini key, Vapi private key and service-role key live only in Edge Function secrets / local `.env`.
- Prototype hosted in Supabase **US West (Oregon)**, next to Vapi, so tool calls stay in one region (ADR-0008); production for an Indian NBFC would need data in India and an India-hosted voice platform (data localisation).

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](adr/ADR-0001-vapi-browser-web-calls.md) | Vapi browser web calls, no phone numbers |
| [0002](adr/ADR-0002-single-webhook-tool-registry.md) | Single webhook + typed tool registry |
| [0003](adr/ADR-0003-supabase-cloud-only.md) | Supabase cloud only; no local Docker stack |
| [0004](adr/ADR-0004-gemini-free-tier.md) | Gemini free tier for AI steps, embeddings, evals (live agent: see 0007) |
| [0005](adr/ADR-0005-verify-before-disclose-in-code.md) | Verify-before-disclose enforced in code |
| [0006](adr/ADR-0006-live-agent-plus-followup-agent.md) | One live voice agent + follow-up agent; rules before agent |
| [0007](adr/ADR-0007-voice-stack.md) | Voice stack: Vapi-hosted GPT, Deepgram (EN + Hinglish), Azure Indian voices |
| [0008](adr/ADR-0008-server-region-next-to-vapi.md) | Database and functions in Oregon, next to Vapi; calls pinned with `x-region` |
| [0009](adr/ADR-0009-call-token-identity.md) | One-time call token, locked to one Vapi call, tells the server who the customer is |
| [0010](adr/ADR-0010-database-http-client.md) | Small HTTP database client in functions instead of supabase-js (faster cold starts) |
| [0011](adr/ADR-0011-compliance-switches-for-testing.md) | Calling hours and attempt limits switchable off for testing; on for demo and go-live |
