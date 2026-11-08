# ADR-0018: Munshi, the owner's voice agent — own tool function, owner-call token, two-step actions in code

## Status
Accepted (2026-11-07, Saim: "Approve all" on the M8 plan, with the amendments at the end). Product choices are Saim's (2026-11-07). Amends ADR-0013 (the owner's main interface becomes a browser call; WhatsApp keeps links, cards, summaries, sends) and ADR-0002 (one tool function per agent, same registry pattern). Builds on ADR-0009, 0012, 0015, 0016. SPEC v2.0 does not cover Munshi yet.

## Context
Srinivas should run the book by talking: ask about dues, history, promises, Asha's last call, insights; add credit, mark paid, delete, remind. A voice LLM can mishear or be talked into an action, so money may change only after a read-back and his yes, enforced in code. Today `sarvam-tools/handler.ts` trusts only a shopkeeper `call_token` (`calls.shopkeeper_id not null`), `calls-api/sarvam-proxy.ts` allows one app id, and `_shared/calls/live-line.ts` sees only `calls`. Hard target: each tool < 0.5 s.

## Decision
- **Separate Sarvam agent** `voice-agents/munshi/` (male Bulbul voice, casual, starts in Telugu and follows the caller; short prompt; asks "anything else?" before ending), same build/push/record path as Asha, own app id `SARVAM_MUNSHI_APP_ID`.
- **Owner identity = single-use signed link.** Menu row "📞 Call Munshi" → webhook creates an `owner_calls` row (`issued`, 15 min) and sends `/munshi#t=<owner_call_id>.<HMAC>` (new `MUNSHI_LINK_SECRET`, not the 24 h read-only dashboard token). Page start → `accepted` (compare-and-set); the proxy picks the session table by app id and issues one URL per row. Tools work 10 min after accept. **No spoken PIN** (see Consequences).
- **Own function `munshi-tools`**: own bearer secret (`SARVAM_OWNER_TOOL_SECRET`, vault `easy-recovery-owner-tool-secret`), own agent variable `owner_call_token` resolved only in `owner_calls`, own registry `_shared/owner-tools/` reusing `defineTool`, bearer check and the audit shape (rows in `owner_tool_events`). Three separate locks: secret, token table, tool names. A shopkeeper token never resolves there; owner tools do not exist in `sarvam-tools`.
- **Reads, one tool call each, answer-ready `say`:** `book_summary` (pending, overdue, due today, insights figures) and `lookup_shopkeeper` (dues, recent entries, open promise, last Asha call and follow-up from the M7 B1 code-built history: facts from records). Names via `ledger/match.ts`; unclear → up to 3 names back.
- **Writes are two-step in code.** `prepare_credit | prepare_payment | prepare_delete | prepare_remind | prepare_send` resolve everything server-side, write one `pending_actions` row tied to the owner call (new kinds, 3 min) and return `{action_ref, say: read-back}`. A new prepare cancels the open one (one open action per call). `confirm_action(action_ref)` runs only the latest open action of this call, unexpired, at least 2 s after its prepare (blocks prepare + confirm in one LLM turn with no owner reply), via compare-and-set `open → saved`, then the same ledger / `queueCall()` code as WhatsApp Save. `cancel_action` closes it. The prompt asks for the yes; the code is the lock.
- **Delete = reversal row** (superseded by Amendment 1: status `reversed` + `ledger_reversals`). `ledger_entries` gets kind `reversal` + `reverses_entry_id` (unique: once per entry); `ledger/dues.ts` and the `balances` view skip a reversed pair. Nothing is hard-deleted.
- **Remind** → `queueCall()` (all pre-call checks), live. `lineState` counts an active owner call as busy, so Asha rings `/phone` only after Munshi hangs up. Follow-up worker unchanged; its WhatsApp summary is sent as today.
- **WhatsApp sends** (see Amendment 2) only through `prepare_send` (pending, due, one statement, insights), confirmed at the end; sent in the background (`EdgeRuntime.waitUntil`) with the existing reply builders, so the tool answers at once.
- **Latency:** Mumbai; auth = one parallel round trip; reads ≤ 2, writes ≤ 2 round trips; no LLM, Translate or Meta call inside a tool; warm ping on page open; `duration_ms` p95 checked in evals.

## Alternatives considered
1) Owner tools in `sarvam-tools` with a role split: one warm function, but Asha's lean bundle grows (cold-start 503, `sarvam-tools/index.ts`), one secret guards both, one routing bug exposes money writes to a shopkeeper call.
2) Confirmation by prompt only: fastest, but the LLM can skip or invent a yes. 3) Hard delete or a `voided_at` flag: loses who/when/what; a reversal keeps the book auditable.
4) Reuse the dashboard token: no new secret, but 24 h, reusable, not bound to one session. 5) Spoken PIN: heard by anyone in the shop, Telugu digits mis-transcribed, an extra turn, PIN lands in Sarvam's transcript. 6) Phone number: paid telephony.

## Consequences
- Security: the link only reaches the verified owner number and starts one session; production would add login or a typed PIN. Same daily cap of 20 sessions counted across `calls` + `owner_calls`.
- Cost: ≈ ₹3.50/min + GST; a Munshi → Asha demo run ≈ ₹20. Bulk testing is text: Munshi in text mode vs an owner persona (simulator pattern), same tools and gates.
- Testing: `deno test` for every confirm refusal (no prepare, wrong/old ref, expired, < 2 s, double confirm, other call) and both cross-scope refusals; reversal maths in dues, insights, `balances`.
- New: migration (`owner_calls`, `owner_tool_events`, `pending_actions.owner_call_id` + kinds, reversal columns, `source` 'munshi'), 3 secrets, `web/` `/munshi` page, second app id in the proxy.
- Open questions for Saim: typed PIN or none · which entries may be reversed (any confirmed vs last 30 days) · Munshi call cap (240 s today) · a WhatsApp receipt after each saved action or strictly none · settle Asha's payment claims by voice · voice and prompt wording · SPEC update and time box.

## Amendments (2026-11-07, approved with the M8 plan)
1. **Delete is a status, not a kind.** The original entry goes `confirmed → reversed` (compare-and-set, so once) and a `ledger_reversals` row records it (`entry_id` unique, `owner_call_id`, `created_at`), both in one SQL function `reverse_ledger_entry(entry_id, owner_call_id)`. Every reader already counts only `confirmed`, so dues, insights, score and `balances` need no change. Replaces the `reversal` kind + `reverses_entry_id` above (M8 Decision 2b).
2. **WhatsApp sends go through a follow-up-worker job** `/owner-send/<actionId>` (`WORKER_SECRET`), kicked by `confirm_action`. The worker builds the replies with today's builders; `munshi-tools` holds no Meta token (M8 Decision 3).
3. **A sixth prepare tool, `prepare_claim`** (settle Asha's payment claims by voice: received / not received). `book_summary` takes a `focus` (overview, due, overdue, promises, claims, insights) so each question is one tool call.
4. **Open questions closed:** no PIN; any confirmed entry of any age can be reversed once; Munshi calls capped at 480 s with a wrap-up note from 7:00; no WhatsApp receipt after an action unless asked; claims by voice: yes.
5. **Line and caps:** `OWNER_CALL_MAX_MS` = 9 minutes (an owner call holds the live line at most that long); `QUEUE_TIMEOUT_MS` = `OWNER_CALL_MAX_MS` + 2 minutes, so a Remind queued during an 8-minute Munshi call still rings afterwards; at most 6 Munshi sessions a day inside the shared daily cap of 20 live sessions.
