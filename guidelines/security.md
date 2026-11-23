# Security Standards

This project simulates a BFSI system. Even with fake data, treat it like a real bank deployment — that is the point of the portfolio.

## Checks before every commit

- [ ] No secrets in code, config, prompts, or logs
- [ ] All external input validated with Zod at the boundary
- [ ] Database access only via parameterised queries / Supabase client (never string-built SQL)
- [ ] No unsanitised HTML rendering (`dangerouslySetInnerHTML` is banned)
- [ ] Every inbound request is authenticated before any processing (constant-time compares):
  - `whatsapp-webhook`: Meta's `X-Hub-Signature-256` HMAC-SHA256 of the raw body, keyed with `META_APP_SECRET` (POST); `WHATSAPP_VERIFY_TOKEN` on the one-time GET handshake; messages from any number other than `OWNER_WHATSAPP_NUMBER` are ignored
  - `sarvam-tools`: `Authorization: Bearer` equal to `SARVAM_TOOL_SECRET` (the secret Sarvam sends on every tool call)
  - `followup-worker`: `Authorization: Bearer` equal to `WORKER_SECRET` (sent by calls-api, whatsapp-webhook and pg_cron via Supabase Vault)
  - `calls-api`: per-call `x-call-token` for the phone page and the Sarvam URL proxy; CORS limited to `CORS_ALLOWED_ORIGINS`
- [ ] Every table has Row Level Security enabled
- [ ] Public endpoints rate-limited
- [ ] Error responses carry an error code only — no stack traces or internals
- [ ] No personal data (names, phone numbers, shop names, amounts tied to a person, message text) in logs (the WhatsApp live-checks table `wa_exchanges` keeps message text for 30 days by decision, ADR-0022; it is a table, not a log)

## Secrets

- Environment variables only. `.env` is git-ignored; `.env.example` lists every variable with a blank value.
- **Frontend may only hold public values**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_REGION`. Never `SUPABASE_SERVICE_ROLE_KEY`, `SARVAM_API_KEY`, `SARVAM_AGENTS_API_KEY`, `SARVAM_TOOL_SECRET`, `META_ACCESS_TOKEN`, `META_APP_SECRET`, `WORKER_SECRET` or `GEMINI_API_KEY` (`npm run check:secrets` scans the built bundle). The browser gets a Sarvam call URL only through the calls-api proxy.
- Edge Functions read secrets from Supabase function secrets.
- Validate required env vars at startup with a Zod schema (`supabase/functions/_shared/env.ts`, one schema per function); fail fast if missing. Bearer secrets are at least 32 characters.
- If a secret is ever exposed (committed, logged, pasted), **rotate it** immediately.
- **LLM tracing (Langfuse, ADR-0023)** is the one place prompts and answers leave our systems. It is off unless `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are both set (function secrets only, never `VITE_`). It is hooked once, in `_shared/llm/json-llm.ts`; no other code sends LLM text anywhere. Sends are fire-and-forget with a 5 s limit, and a failed send logs `langfuse_send_failed` with a status or error class only. `LANGFUSE_REDACT=on` masks numbers, JSON name fields and capitalised Latin words and leaves out the system prompt. Off is allowed only while every name and amount is fake; with real data, use redact on with a host in India, or no tracing.

## Data access

- RLS on all tables. The browser never reads customer/loan tables directly; it goes through Edge Functions, which use the service role server-side.
- Least privilege: each function touches only the tables it needs.
- No custom crypto, no custom auth. If dashboard login is added, use Supabase Auth.

## BFSI-specific rules (enforced in code, tested at 100%)

- **Verify before disclose** — no amount or due date is returned by any tool until `confirm_identity` has succeeded for that call (name + shop confirmed).
- **No third-party disclosure** — if the person is not the shopkeeper, the agent reveals nothing about the dues; the call stays locked.
- **Calling hours** — calls only 08:00–19:00 IST.
- **Attempt limits** — maximum call attempts per shopkeeper per day/week.
- **Do not call** — a shopkeeper who asked not to be called is never called.
- These pre-call rules live once in `_shared/compliance/precall.ts` and run before every live or simulated call.
- **No threats / harassment** — enforced by prompt constraints and checked in post-call compliance review and evals.
- **Amounts and dates only from tool results** — the agent never states a figure that didn't come from a tool.
- **Audit trail** — every call stores transcript, tool calls with arguments/results, compliance check results, and outcome.
- Personal data in the audit trail is kept to what the call needs; the owner's number is never stored or logged; rows keep only a keyed HMAC-SHA256 hash (`sender_hash`).

## Dependencies

- `npm audit` / `deno` lockfiles checked each milestone; no known critical vulnerabilities.
- Pin versions (lockfiles committed).
- Only add a dependency when it clearly earns its place.

## Error responses

- Map every error to an entry in `ERROR_CODES` with a safe message.
- Log full detail server-side (without personal data).
- Never return stack traces, SQL errors, or provider error bodies to the client, to Sarvam or to Meta.

## Security response protocol

If a security issue is found at any point:
1. **Stop** current work.
2. Rate severity: Critical / High / Medium / Low.
3. Fix Critical before anything else.
4. Rotate any possibly exposed secret.
5. Search the codebase for the same pattern.
6. Note it in the milestone review report.
