# Architecture — Suvidha Finance Voice AI

Status: M0 (foundation). Updated by the `architect` agent when decisions change.

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
| Shared core | Env, errors, Zod schemas, compliance rules, tools, follow-up rules | `supabase/functions/_shared/` |
| Database | Fake core banking, call audit, follow-ups, notes, knowledge chunks, evals | `supabase/migrations/` |
| Dashboard | KPIs, customers, simulator, calls, follow-ups, human queue, evals | `web/` |
| Evals | Simulated conversations, judge, release gate | `evals/` |

## One call, end to end

1. Dashboard → `calls-api` pre-call check (hours, attempts, do-not-call) → returns call metadata (customer id).
2. Browser starts a Vapi web call with that metadata; agent greets with AI + recording disclosure.
3. Agent calls tools → `vapi-webhook` identifies the customer **from call metadata**, enforces verify-before-disclose, validates args, logs `tool_events`.
4. Call ends → Vapi end-of-call report → transcript saved → summary → compliance check → follow-up agent.
5. Follow-up agent: rules decide clear cases; agent decides judgement calls; guarded tools act; a note is always written.
6. Next call → `lookup_loan` returns the latest note and last promise.

## Data model

See `supabase/migrations/20261031000001_schema.sql` (SPEC §10). Lead-qualification tables are deferred until that scope is approved.

## Security boundaries

- Browser holds only the Supabase anon key and the Vapi public key.
- RLS is enabled on every table with **no** anon/authenticated policies — the browser cannot read data directly; Edge Functions use the service role server-side.
- Vapi → webhook requests must carry the shared secret.
- Gemini key, Vapi private key and service-role key live only in Edge Function secrets / local `.env`.
- Prototype hosted in Supabase **EU (Ireland)**; production for an Indian NBFC would use the Mumbai region (data localisation).

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
