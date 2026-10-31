# Security Standards

This project simulates a BFSI system. Even with fake data, treat it like a real bank deployment — that is the point of the portfolio.

## Checks before every commit

- [ ] No secrets in code, config, prompts, or logs
- [ ] All external input validated with Zod at the boundary
- [ ] Database access only via parameterised queries / Supabase client (never string-built SQL)
- [ ] No unsanitised HTML rendering (`dangerouslySetInnerHTML` is banned)
- [ ] Vapi webhook requests verified (shared secret header) before any processing
- [ ] Every table has Row Level Security enabled
- [ ] Public endpoints rate-limited
- [ ] Error responses carry an error code only — no stack traces or internals
- [ ] No personal data (names, phone, DOB, amounts tied to a person) in logs

## Secrets

- Environment variables only. `.env` is git-ignored; `.env.example` lists every variable with a blank value.
- **Frontend may only hold public keys**: Supabase anon key, Vapi public key. Never the Supabase service-role key, Vapi private key, or Gemini key.
- Edge Functions read secrets from Supabase function secrets.
- Validate required env vars at startup with a Zod schema; fail fast if missing.
- If a secret is ever exposed (committed, logged, pasted), **rotate it** immediately.

## Data access

- RLS on all tables. The browser never reads customer/loan tables directly; it goes through Edge Functions, which use the service role server-side.
- Least privilege: each function touches only the tables it needs.
- No custom crypto, no custom auth. If dashboard login is added, use Supabase Auth.

## BFSI-specific rules (enforced in code, tested at 100%)

- **Verify before disclose** — no loan detail is returned by any tool until `verify_customer` has succeeded for that call.
- **No third-party disclosure** — if the person is not the borrower, the agent reveals nothing about the debt.
- **Calling hours** — calls only 08:00–19:00 customer local time (IST).
- **Attempt limits** — maximum call attempts per customer per day/week (constants in `compliance/rules.ts`).
- **No threats / harassment** — enforced by prompt constraints and checked in post-call compliance review and evals.
- **Amounts and dates only from tool results** — the agent never states a figure that didn't come from a tool.
- **Audit trail** — every call stores transcript, tool calls with arguments/results, compliance check results, and outcome.
- Customer data in the audit trail is masked where not needed (e.g. last 4 digits of loan number).

## Dependencies

- `npm audit` / `deno` lockfiles checked each milestone; no known critical vulnerabilities.
- Pin versions (lockfiles committed).
- Only add a dependency when it clearly earns its place.

## Error responses

- Map every error to an entry in `ERROR_CODES` with a safe message.
- Log full detail server-side (without personal data).
- Never return stack traces, SQL errors, or provider error bodies to the client or to Vapi.

## Security response protocol

If a security issue is found at any point:
1. **Stop** current work.
2. Rate severity: Critical / High / Medium / Low.
3. Fix Critical before anything else.
4. Rotate any possibly exposed secret.
5. Search the codebase for the same pattern.
6. Note it in the milestone review report.
