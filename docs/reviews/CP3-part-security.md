# CP3 review — part: money and security paths

Scope: changes since 4f32c4d (CP2) to working tree on cp3-review. Reviewer: security sub-reviewer.

## Findings

### S-H1 — High — the grace wait back-dates the new change, so the 2-second "no yes yet" lock is mostly bypassed

- **File:** `supabase/functions/_shared/owner-tools/actions.ts:L95-L107` (nextRef pause) with `actions.ts:L120-L139` (storeAction `createdAt = ctx.realNow`) and `confirm-action.ts:L95` (TOO_SOON gate); `ctx.realNow` is fixed once per request in `munshi-tools/handler.ts:L241-L244`.
- **What:** `nextRef` now waits `REPLACE_GRACE_MS` (1.5 s) when an older change is confirmable. `storeAction` then writes the new voice action with `created_at = ctx.realNow`, the time the request *started*, i.e. before the 1.5 s pause and before the prepare's other DB rounds. The confirm gate measures `now - createdAt < MIN_CONFIRM_DELAY_MS (2 s)`. So for any prepare that hit the grace wait, the read-back reaches the LLM already ~1.7-2 s "old", and the 2 s lock (M8-R1: refuse a prepare + confirm chained in one LLM turn) shrinks to roughly 0-0.3 s.
- **Failure scenario:** Owner hears r1 "Ramesh paid 500, correct?", says "no, 600". The LLM calls `prepare_payment` (r1 is >2 s old, so the grace wait runs), gets r2, and in the same turn chains `confirm_action("r2")` without waiting for his answer. The confirm arrives ~0.5 s after the reply, `now - created_at` is about 2.2 s, the gate passes, and a 600 payment is written to the ledger that the owner never said yes to. This is exactly the correction path, the most common place for a second prepare.
- **Suggested fix:** Take the stored `created_at` (and `expires_at`) from a fresh clock read after `nextRef`/all reads finish (e.g. pass `now()` into `storeAction` or add a `clock` to the context), and add a test where the pause runs and a confirm follows the prepare reply within 2 s and must get TOO_SOON. Keep the cancel boundaries consistent with the new timestamp.
- **Owner decision:** plain code fix (money-safety rule, no wording change).

### S-M1 — Medium — a confirm whose write times out is reopened, so a second "yes" can save the same payment twice

- **File:** `supabase/functions/_shared/owner-tools/confirm-action.ts:L116-L130` (catch: `saved → open`), with `executePayment`/`executeCredit` calling `book.insertEntry` (`_shared/db/supabase-book-repository.ts:L117-L135`, plain POST, no idempotency key) under the 5 s `DB_TIMEOUT_MS` abort in `_shared/db/postgrest.ts:L86`.
- **What:** Any error after the claim is won puts the action back to `open` so he can say yes again. But a timeout or dropped response on the ledger POST does not mean the row was not written: PostgREST may have committed it. Nothing ties the ledger row to the voice action, so the retry inserts a second row.
- **Failure scenario:** Owner confirms "Ramesh paid 2,000". The insert commits but the reply is slow (cold DB, network blip) and the 5 s abort fires. Munshi says "can't check the book right now, ask again in a minute" (TEMPORARY_ERROR). The action is open again, same ref, still inside 3 minutes; he says "yes" again, the gate passes and a second 2,000 payment is written. The ledger now shows 4,000 received.
- **Suggested fix:** Make the write idempotent per voice action: add a nullable unique `voice_action_id` (or `pending_action_id`) column on `ledger_entries` and send it on insert (a duplicate then fails safely and can be treated as already done), or on the reopen path first look for an entry with that action id. Alternatively, do not reopen on timeout/abort errors; close as "check the book before trying again". Add a test where `insertEntry` writes and then throws.
- **Owner decision:** plain code fix.

### S-M2 — Medium — DASHBOARD_PUBLIC=on now also opens a free-text write (test drafts) to anyone, with no rate limit

- **File:** `supabase/functions/calls-api/test-draft-routes.ts:L72-L103` (`add: openInDemo(addDraft)`), `calls-api/dashboard-routes.ts:L39-L46` (`openInDemo` skips the link check for every route it wraps).
- **What:** In public mode every `openInDemo` route skips the signed link. That now includes `POST /v1/dashboard/test-drafts`, which stores caller-supplied text (`said` up to 1,000 chars, `expected` up to 500) in `test_drafts`; those drafts are listed on the Evals page and are meant to become scripted tests. There is no per-day cap or rate limit. `docs/threat-model.md:L43` still says public mode opens "every dashboard read (and the one display setting)", so this write is not covered by the documented risk. `security.md` (Checks: "Public endpoints rate-limited").
- **Failure scenario:** While the demo URL is shared publicly (the purpose of the switch), anyone can script POSTs with `source: "whatsapp"` and arbitrary `said`, filling `test_drafts` with junk or abusive text that then shows on the Evals page during a Sarvam pitch and is copied into the eval backlog.
- **Suggested fix:** Keep the test-draft POST behind the signed link even in public mode (use `guarded`, not `openInDemo`, for writes), or add a small daily cap (count today's drafts before insert). Update `docs/threat-model.md` to list exactly which routes public mode opens.
- **Owner decision:** owner decision (what the public demo may do); the code change itself is small.

## Checked, no finding

- `munshi-tools`: bearer secret checked before body parse (constant-time, hashed); token is a UUID that only resolves in `owner_calls`; status, 10-minute TTL from `accepted_at` and owner match all checked; eval owners served only when `is_eval = true` (filter in the query), with queueCall and the WhatsApp kick stubbed. All Munshi reads are scoped by `owner.id` or by shopkeeper ids taken from that owner's list.
- Confirm compare-and-set (`transitionVoiceAction` filters on the expected status), twin-ref drop, expiry, REPLACED_NOT_SAVED vs ALREADY_DONE on a lost claim: correct as written.
- `prepare_payment` claim matching: only a single open claim of the same amount is turned into a claim acceptance; several matches fall back to a normal payment (claims are never counted, so no double count).
- `sarvam-tools`: auth order unchanged; only tracing and `markEvalTraffic` added.
- `whatsapp-webhook`: Meta HMAC check and owner-only routing unchanged; the Munshi link is HMAC-signed with its own secret and prefix, single-use, 15 min, 3 per 10 min, daily session cap.
- `calls-api` Sarvam proxy: org/workspace/app pinned, signed owner-call token for Munshi, accept window, shared daily cap plus Munshi cap, 10 s upstream timeout, no key to the browser.
- Migrations since 4f32c4d: every new table has RLS on and no policies; new SQL functions set `search_path = ''` and revoke execute from public/anon/authenticated; cron jobs use the existing Vault-backed worker call (no secret in SQL).
- Logs/traces: request routes hide long tokens; log fields seen carry ids, codes and counts only.

## Summary

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | pass |
| High | 1 | warn |
| Medium | 2 | info |
| Low | 0 | note |

**Verdict (security part): Warning** — no Critical; S-H1 should be fixed before go-live because it weakens the money confirm lock.
