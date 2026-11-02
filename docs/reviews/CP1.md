# CP1 — Checkpoint review (M0 → M2)

**Scope:** everything built from the start through M2 — commits `fb3d15d` (M0) … `05b27d4` (M2), branch `feature/M2-platform-tools`. Main focus is M2 (`git diff be0a3e0..05b27d4`, 77 files).
**Reviewed against:** `guidelines/coding-standards.md`, `guidelines/security.md`, `guidelines/testing.md`, `docs/architecture.md`, ADR-0001…0008, `docs/milestones/M1.md` + `M2.md`.
**Reviewer:** `reviewer` agent, 2026-11-02. Items already in the M2 Results "M3 backlog" are not repeated here.

## Code review

### Verdict: **Warning**: 2 High, no Critical

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | pass |
| High | 2 | warn |
| Medium | 4 | info |
| Low | 3 | note |

### What was checked and holds up

- **Webhook auth:** the secret is checked before the body is read (`vapi-webhook/handler.ts:179-184`). Both sides are SHA-256 hashed first, then compared with std `timingSafeEqual`. A wrong or missing secret returns 401 with nothing processed. Tested.
- **Identity from the token, never the LLM:** no customer identifier exists in any tool schema. The token is a UUID and is bound to the first Vapi call with a conditional `PATCH … vapi_call_id=is.null`, so there is no race. It has a 10-minute window to claim.
- **Verify-before-disclose:** `lookup_loan`, `log_promise_to_pay` and `send_payment_link` all call `requireVerified` before any read. `transfer_to_human` is deliberately open. Session state carries through a batch, so "verify then lookup" in one request works.
- **Validation:** every boundary is parsed with Zod: env, webhook envelope, tool args, calls-api body, PostgREST rows, browser config and API responses.
- **SQL:** no string-built SQL. PostgREST paths only take ids that were UUID-validated upstream and are `encodeURIComponent`-encoded. RLS is on for all 16 tables with no anon policies.
- **Secrets:** the frontend holds only the anon key and the Vapi public key. The webhook secret is added at push time only. The bundle scan covers 6 secrets. The deploy script passes secrets through a 0600 temp file that is deleted in `finally`.
- **Logs:** `log.ts` takes ids, codes and timings only. Postgres error bodies are reduced to an error code. No DOB, name or amount appears in function logs (a test asserts this).
- **Timeouts:** DB 5 s, browser 10 s, Vapi push 15 s, Vapi tool server 10 s.
- **Coverage, re-run by the reviewer:** 108 Deno tests pass. Compliance, tools, guards, the webhook handler and the calls-api handler are all at 100% branch and line coverage.
- **Standards:** no `any`, no `console.log` outside `log.ts`, no inline JSX handlers, no TODOs, no `dangerouslySetInnerHTML`. Every tracked source file has its path comment. Every function is under 50 lines and every file under 400 lines.
- **Language versions:** the greeting, recording notice, idle line, closing line and script rule exist in both EN and HI.

### Issue cards

#### H1 — DOB redaction fails open: an unparseable or oddly-keyed argument stores the DOB in `tool_events`

```
File: supabase/functions/vapi-webhook/handler.ts:L17, L110-L126, L149-L154
Severity: High
What: The audit row stores the *raw* tool arguments, filtered by a denylist that only replaces
      a top-level object key named exactly "dob". If the arguments string doesn't parse,
      parseArguments returns it unchanged and redact() passes strings through unchanged.
      Failure scenarios:
      (a) the LLM emits truncated JSON '{"dob":"1988-04-12"' -> INVALID_ARGS, and
          tool_events.args = '{"dob":"1988-04-12"' (plain DOB in the audit trail);
      (b) the LLM sends {"date_of_birth": "..."} or {"dob": "...", "spokenDob": "3rd Sept 1991"}
          -> the extra or renamed key is stored as-is (Zod strips it for the tool, but the audit
          row keeps the raw object).
      The existing test (handler.test.ts:231) uses '{oops', which contains no DOB, so it passes.
Why: security.md › BFSI rules (customer data in the audit trail masked where not needed;
     no personal data in logs). M2 Results decision "DOB never stored in the audit log".
     coding-standards › Validation ("never trust LLM output").
Impact if ignored: a borrower's DOB, which is the identity secret, lands in a table read by the
     dashboard, the follow-up agent and evals.
Suggested fix: audit an allowlist, not a denylist. Store the schema-parsed args when
     validation passes. Store a fixed marker ('[unparseable]' / '[invalid]') when it fails.
     For verify_customer, always store {dob:'[redacted]'}. Add tests for (a) and (b) that use
     the real DOB.
```

#### H2 — A database error inside a tool aborts the whole batch with HTTP 500: no audit row, partial writes, and no safe instruction to the LLM

```
File: supabase/functions/vapi-webhook/handler.ts:L132-L165 (runToolCalls), L194-L196
Severity: High
What: runToolCalls has no per-tool error handling. Any repository rejection (5 s DB timeout,
      PostgREST error) escapes to withErrorBoundary, which answers HTTP 500 for the whole request.
      Failure scenarios:
      (a) log_promise_to_pay: insertPromise succeeds, then insertToolEvent times out -> 500.
          The promise is saved with no audit row. Vapi reports a tool failure, so Asha may ask
          again and log a duplicate promise.
      (b) In the batch [verify_customer, lookup_loan], the lookup's DB read fails. Verification
          is already written to `calls`, but the verify result is never returned and neither
          call gets an audit row.
      (c) The LLM receives a transport error instead of a TOOL_ERRORS message telling it to share
          no figures and offer a callback, so what it says next is unguided. This matters
          because amounts must come only from tool results.
      The only 500 test (handler.test.ts:268) covers getCallSession, before authorisation,
      where a 500 is correct.
Why: coding-standards › Error handling ("handle errors explicitly at every level").
     security.md › Audit trail ("every call stores … tool calls with arguments/results").
     ADR-0002 ("every tool … writes a tool_events audit row"). M2 acceptance criterion.
Impact if ignored: missing or duplicate audit and promise rows on the compliance-critical path,
     plus an uncontrolled agent reply after any DB hiccup.
Suggested fix: wrap each runTool call in try/catch. Map failures to a new tool code (e.g.
     TEMPORARY_ERROR: "Something went wrong. Share no loan figures; apologise and offer a
     callback from a colleague."). Log the error and still write the audit row. Treat an
     audit-insert failure separately (log it, keep the tool result), so every toolCallId gets
     its own result. Add tests for (a) and (b).
```

#### M1 — Verification lockout is per call, so DOB guessing has no per-customer limit

```
File: supabase/functions/_shared/tools/verify-customer.ts:L5-L18;
      supabase/functions/calls-api/handler.ts:L54-L99;
      supabase/functions/_shared/db/supabase-repository.ts:L160-L164
Severity: Medium
What: MAX_VERIFY_ATTEMPTS = 2 is counted on the `calls` row. A new token resets it. Tokens are
      free: calls-api needs only the public anon key, has no rate limit, and attempt limits are
      off by default. That makes 2 guesses per call, with unlimited calls per customer.
      Also, recordVerification is a blind PATCH (not compare-and-set like claimCall), so
      parallel webhook requests on the same call each get their own 2 attempts.
Why: SPEC §5.5 Tools (verify_customer: "Max 2 attempts"), ADR-0005, security.md › BFSI rules.
Impact if ignored: on real phone lines, repeated calls to guess a DOB is the classic
     social-engineering path. Mitigated today because this needs a real voice call through the
     secret-holding assistant, and the data is fake.
Suggested fix: count failed verifications per customer per IST day across calls. Refuse with
     VERIFY_LOCKED and suggest a handoff once the limit is hit. Make recordVerification
     conditional (`verify_attempts=eq.<previous>`).
```

#### M2 — `calls-api` has no rate limiting (security.md pre-commit checklist)

```
File: supabase/functions/calls-api/handler.ts:L54-L105; supabase/functions/_shared/errors.ts:L17 (RATE_LIMITED defined, never used)
Severity: Medium
What: The anon key is public (it is in the bundle), and CORS does not stop non-browser clients.
      A script can loop POST /v1/calls/authorize. Each request inserts a `calls` row, and the
      count and insert are not atomic.
      Concrete demo failure: when `call_limits_enabled` is switched on to demo the attempt rule,
      anyone (or a runaway retry) can use up a borrower's 3 daily attempts. The real demo call
      is then blocked with ATTEMPT_LIMIT_REACHED.
Why: security.md › Checks before every commit ("Public endpoints rate-limited"). M2 Decision 5
     accepted "no login", not "no rate limit".
Impact if ignored: unbounded table growth, and the attempt-limit demo can be sabotaged.
Suggested fix: add a minimal limit before createCall (e.g. refuse with RATE_LIMITED if this
     customer already has a call created in the last N seconds, checked in the same count
     query). Record the remaining gap next to Decision 5.
```

#### M3 — The webhook smoke test leaves permanent rows in the only database: the seed check now fails, and M3's "last promise" will read test data

```
File: scripts/smoke-webhook.ts:L168-L184; scripts/check-seed.ts:L6-L16
Severity: Medium
What: Every `npm run smoke:webhook` adds 1 `calls` row, 5 `tool_events` rows and 1 `promises`
      row (₹4,200, UPI, today+3) for seeded borrower Ravi. Nothing is cleaned up. check-seed.ts
      expects exact totals (calls: 5, promises: 3), so `npm run db:check-seed` fails after any
      smoke run or voice test. This is the check ADR-0003 and ADR-0008 rely on.
      In M3, lookup_loan returns the latest promise, so Asha will tell Ravi about a promise
      the smoke test made.
Why: testing.md › Quality ("independent and isolated; no shared mutable state").
     ADR-0003 (seed is the reference state).
Impact if ignored: a false seed-check failure, and wrong "you promised…" lines in the M3 tests
     and the demo.
Suggested fix: delete the smoke call's tool_events, promises and calls rows in the existing
     `finally` (service role, by call id). Make check-seed assert the seeded ids rather than
     table totals.
```

#### M4 — No error boundary around the live-call page

```
File: web/src/main.tsx:L23-L27; web/src/features/voice-spike/VoiceSpikePage.tsx
Severity: Medium
What: The page holds live call state and a form (customer picker), but nothing wraps it in an
      error boundary. Any render error blanks the whole app mid-call.
Why: coding-standards › React rules ("Wrap pages with forms or live call state in an error boundary").
Impact if ignored: a white screen during a demo call. The page is replaced in M5, but the rule
     applies to the simulator too.
Suggested fix: add one small shared ErrorBoundary (friendly message, no stack) in App.tsx now,
     and reuse it for the M5 simulator.
```

#### L1 — Stale comments

```
File: supabase/functions/vapi-webhook/handler.ts:L14; supabase/config.toml:L418
Severity: Low
What: "calls are capped at 2 minutes" (the cap is now 240 s); the import-map comment lists
      "supabase-js", which the functions no longer use.
Why: coding-standards › Comments (explain why, accurately).
Impact if ignored: misleads the next reader about TTL headroom and dependencies.
Suggested fix: update both comments.
```

#### L2 — `docs/architecture.md` has drifted from M2

```
File: docs/architecture.md:L3, L44-L46, L63-L73
Severity: Low
What: Status still says "M0". The ADR table stops at 0007 (0008 is missing). "One call" step 1
      says calls-api "returns call metadata (customer id)" and step 3 says the webhook
      identifies the customer "from call metadata", but the built design is a one-time call
      token locked to the first Vapi call.
Why: workflow.md › Scoring (Architecture fit is scored against this file).
Impact if ignored: the evaluator and interviewers read a weaker design than the one built.
Suggested fix: update the status, add ADR-0008 to the table, and describe the call-token flow
     (copy the M2 plan diagram).
```

#### L3 — The call page shows raw SDK error text

```
File: web/src/lib/vapiClient.ts:L47-L51
Severity: Low
What: describeError returns `error.message` from the Vapi/Daily SDK verbatim to the error
      banner. This contradicts its own comment ("never surface raw SDK error objects").
Why: coding-standards › Error handling ("UI shows friendly messages; never raw errors").
Impact if ignored: internal provider text in front of a user or demo audience.
Suggested fix: always return the fixed friendly message, and keep the raw message for a
     dev-only log if needed.
```

### Backlog

L1–L3 are appended to `docs/reviews/review-backlog.md` (CP1, Low). The coordinator decides on H1, H2 and M1–M4 (Fix now, Skip or Backlog).

## Fixes applied (2026-11-02, Saim: "fix everything")

Every issue was fixed, including the Lows; none was deferred.

| Issue | Fix | Proof |
|---|---|---|
| **H1** DOB in audit | The registry returns `auditArgs`: schema-parsed arguments only. `verify_customer` always stores `{dob:'[redacted]'}`; anything that fails validation stores `'[invalid]'`, and an unknown tool stores `'[unknown tool]'`. Raw LLM output never reaches `tool_events`. The denylist `redact()` is gone. | `handler.test.ts`: truncated JSON with the real DOB, renamed `date_of_birth`, extra `spokenDob`, extra key on a promise. `registry.test.ts`: audit args per case |
| **H2** DB error → 500 | Each tool runs inside a try/catch in the registry. A throw becomes `TEMPORARY_ERROR` ("share no loan figures; a colleague will call back"), still gets an audit row, and is logged with the operation and code only (any other error is logged by its name alone). An audit-write failure is logged and the tool result is kept, so no duplicate promise is invited. Every toolCallId gets its own result. | `handler.test.ts`: DB error in lookup; non-DB error; failing verify then lookup (→ NOT_VERIFIED, no figures leak); failed audit write keeps the promise; a non-Error throw |
| **M1** lockout per call | A cap of 6 failed DOB attempts per customer per India day, across calls (`MAX_FAILED_VERIFY_ATTEMPTS_PER_DAY`). `recordVerification` is now a compare-and-set on `verify_attempts`, so parallel requests can't both spend an attempt. | `registry.test.ts`: 3 earlier calls lock a fresh one; yesterday's and verified calls don't count; a lost race gives TEMPORARY_ERROR. `supabase-repository.test.ts`: conditional PATCH and the sum |
| **M2** no rate limit | `calls-api` authorise refuses a 4th authorisation per customer within 60 s (real clock) with `RATE_LIMITED` (429). | `calls-api/handler.test.ts`: 4th within a minute → 429, no row; other customers and older calls aren't affected |
| **M3** smoke leaves rows | `smoke-webhook` deletes its call(s) and child rows in `finally`, including leftovers from earlier runs (`vapi_call_id like smoke-*`). `check-seed` finds the seed rows by id and reports test calls for information only. | Live: "Cleaned up 6 smoke-test call(s)"; `db:check-seed` passes (9/9 seed checks plus the RLS check) |
| **M4** no error boundary | Shared `components/ErrorBoundary.tsx` wraps the app and shows a friendly card, never the error text. Reusable for the M5 simulator. | `ErrorBoundary.test.tsx` |
| **L1** stale comments | Token TTL comment updated (4 min); import-map comment updated (no supabase-js). | — |
| **L2** architecture drift | `docs/architecture.md`: status, call-token flow, rate limit, audit allowlist, ADR rows 0008–0011. New **ADR-0009** (call-token identity), **ADR-0010** (database HTTP client), **ADR-0011** (compliance switches: off for testing, on for demo/go-live via M4 demo controls and the M7 checklist). | — |
| **L3** raw SDK error text | The call page always shows one fixed friendly message. | `vapiClient.test.ts` |
| Evaluator gap 7 | The live refused-before-verification attempt is recorded in the M2 voice-test table (Anita #3, "Do I owe you anything?" → asked for DOB first). | `docs/milestones/M2.md` |

**After the fixes:** `npm run check` passes. Deno **123**, agent config **55**, web **33**. Coverage is 100% lines and branches on compliance, tools, the registry, the webhook handler and the calls-api handler. Functions are redeployed; the webhook smoke passes 12/12 and cleans up after itself; the seed check passes.

## Score

**Evaluator:** `evaluator` agent, 2026-11-02. Scope: M0, M1, M2 (`fb3d15d` … `05b27d4`). Scored only on what the files and re-run commands show.

### Step 0: Artifact check

| Artifact | M0 | M1 | M2 |
|---|---|---|---|
| `docs/milestones/<M>.md` › Plan | Y | Y | Y |
| `docs/milestones/<M>.md` › Results | Y | Y | Y |
| Results include test totals | Y (14 Deno + 2 web) | Y (20 + 18 + 14, in the quality-gate table) | Y (108 + 55 + 31) |
| `docs/reviews/CP1.md` › Code review | Y (verdict **Warning**, not Block) | | |

No artifact is missing, so no criterion is zeroed.

### Step 1: Cross-validation

| Check | Result |
|---|---|
| Every plan item has a Results entry | **Mostly.** M0: all items, with the `delivery/` docs removed by Saim. M1: all files exist and all acceptance criteria are evidenced. M2: every "What I'll build" row is in the Results (`_shared/db.ts` became the `_shared/db/` folder). Exception: Acceptance criterion "provably refused … **live attempt**" (plan smoke #1, ask for dues before verifying) has no row in the voice-test table. The refusal is proved only by the unit tests and the deployed webhook smoke. |
| Every file path in the Results exists | **Yes.** I checked the files named in the Results against `git ls-files`, and all are tracked. |
| Test results are real | **Yes.** I re-ran `npm run check`: it passed (exit 0). Deno **108/108**, agent config **55/55**, dashboard **31/31**, the same counts as the M2 Results. Format, lint (`--max-warnings=0`), typecheck, build, the bundle secret scan (6 secrets) and Deno fmt/lint/check all passed. |
| Coverage | Deno: 99.9% lines, 98.0% branches overall. **100%** lines and branches on `compliance/*`, `tools/*`, `clock.ts`, `env.ts`, `errors.ts`, `http.ts`, `vapi-webhook/handler.ts` and `calls-api/handler.ts`. Agent config: 100%. Dashboard: 96.2% lines, 89.7% branches. |
| Seed reference state (M0 done-when, ADR-0003/0008) | **Fails today.** I ran `npm run db:check-seed` (read-only). It found calls 18 (5 expected), promises 9 (3 expected) and handoffs 5 (1 expected). RLS still blocks the anon key. This confirms review finding M3. |
| Review verdict | Warning (0 Critical, 2 High). I checked H1 and H2 in the code. H1: `handler.ts` L17 and L110–126 use a denylist on the top-level `dob` key, unparseable strings pass through unchanged, and the test at L233 uses `'{oops'`, which contains no DOB. H2: `runToolCalls` (L132–165) has no per-tool try/catch, and the only 500 test (L268) fails before authorisation. Both findings are confirmed. |
| Extra finding (not in the review) | SPEC §9 and security.md › BFSI make 08:00–19:00 IST a code-enforced rule, and the approved M2 plan (Decision 2) said hours are "always on". Migration `20261101000002_calling_hours_switch.sql` ships the rule **off by default** (`calling_hours_enabled default false`). Saim approved this during the build for testing, and the Results record it. No ADR records it, and nothing says when it is switched back on. |

### Step 2: Scores (25% each)

| Criterion | Score | Evidence |
|---|---|---|
| **Architecture fit** | **7.0** | **For:** ADR-0002 is followed: one webhook, and a typed `Record<ToolName, RegisteredTool>` registry (`tools/registry.ts:38`), so there is no switch ladder. ADR-0005 is followed: `requireVerified` runs on three tools, and identity comes from the server-issued call token, never from tool args. ADR-0007 voice stack and ADR-0008 Oregon region are applied (`x-region` pinning). Vapi tool definitions are generated from the server's Zod schemas (`voice-agents/collections/tools.ts` imports `_shared/tools/schemas.ts`), so there is one source of truth. The repository interface is injected and faked in tests. **Against:** `docs/architecture.md` has drifted. Its status still says M0, the ADR table has no 0008, and the call flow says "customer id in metadata" rather than the one-time call token (L2). Three costly-to-reverse M2 decisions have **no ADR**: the call-token identity model (M2 Decision 1), replacing supabase-js with a hand-rolled PostgREST client, and calling hours defaulting off against SPEC §9. ADR-0002's "every tool writes a `tool_events` row" does not hold on the failure path (H2). |
| **Completeness** | **8.0** | **For:** every M0, M1 and M2 plan item is built and recorded. M1 meets all five SPEC acceptance criteria (EN/HI calls, interruption, latency 1.15–1.27 s, the Gemini question answered, ADR-0007). M2 "done when" is evidenced by voice call Anita #4 (verify → ₹6,500 → promise saved) and a deployed webhook smoke of 12/12. The 8 voice-test fixes are recorded, and the leftovers are backlogged to M3 rather than left half-done. **Against:** the "live attempt" leg of the refused-before-verification criterion has no recorded result. The M2 criterion "every tool call … audited" fails on any DB error (H2). The M0 seed check, the reference-state check, is now red because smoke and voice tests leave rows behind (M3, verified). The plan said calling hours are "always on", but they ship off. |
| **Tests** | **8.0** | **For:** all 194 tests pass on re-run, and the counts match the Results. Coverage is well above 80% everywhere. 100% coverage is met on every critical area testing.md names: money and promise policy, identity (`verify-customer`), compliance (`precall`, guards), webhook auth and validation. Boundary tests exist (calling-hour edges 07:59/08:00/18:59/19:00, attempt 4th/8th, a token replay). There is a DOB-not-in-logs assertion. A deployed smoke test covers the real DB without voice credit. **Against:** 100% line coverage hides two real gaps on compliance-critical paths. The unparseable-args test uses `'{oops'`, so it passes while a truncated `{"dob":…` would leak (H1). No test injects a repository failure inside a tool (H2). The smoke test is not isolated (testing.md › "no shared mutable state"), which is why the seed check now fails. |
| **Standards** | **6.5** | **For:** no Critical issues. Lint, format and typecheck are clean with `--max-warnings=0`, with owner rules enforced in ESLint. I spot-checked the path comment on line 1 of every tracked `.ts`, `.tsx` and `.sql` file, and all are present. There are no `.js` files. The only `console.log` is inside `log.ts`. I found no `any`, the bundle secret scan passes, secrets go through a temp file, RLS is on all 16 tables, and Zod validates every boundary. **Against:** these checklist items are failed or open: **H1**, a DOB can reach `tool_events` (security.md › BFSI masking and personal data). **H2**, there is no per-tool error handling, no audit row on failure, and no safe message to the LLM (coding-standards › Error handling; security.md › Audit trail). **M2**, there is no rate limit on public `calls-api` (an explicit security.md pre-commit item; `RATE_LIMITED` is defined but never used). **M4**, there is no error boundary on the live-call page (coding-standards › React rules). **L3**, raw SDK `error.message` is shown in the UI (coding-standards › Error handling). Calling hours are off by default against a security.md BFSI rule. Two High issues are open, and workflow.md requires them fixed before M3. |

### Final

| Arch | Complete | Tests | Standards | **Final** | **Rating** |
|---|---|---|---|---|---|
| 7.0 | 8.0 | 8.0 | 6.5 | **7.4 / 10** | **Green** (> 7). The margin is small (0.4), and it holds only if H1 and H2 are fixed before M3 starts (workflow.md › Checkpoints). |

### Gaps

1. **H1** (open): DOB redaction fails open; there is no test with a real DOB in truncated or renamed args.
2. **H2** (open): a DB error inside a tool returns 500 for the whole batch, with no audit row and no safe fallback; there is no failure-injection test.
3. `db:check-seed` fails: the smoke and voice tests leave 13 calls, 6 promises and 4 handoffs behind (M3), and M3's "last promise" will read them.
4. `calls-api` is not rate-limited (M2); verification lockout is per call, not per customer (M1).
5. There is no error boundary around the call page (M4), and raw SDK error text is shown (L3).
6. `docs/architecture.md` is stale (L2). There are no ADRs for the call-token identity model, the hand-rolled PostgREST client, or calling hours defaulting off.
7. The live pre-verification refusal attempt from the M2 smoke plan is not recorded in the voice-test results.
8. The calling-hours rule ships off by default, against SPEC §9 and security.md, with no switch-on point recorded.

### What would raise the score

1. **Fix H1 and H2 with real tests.** Audit an allowlist of schema-parsed args, with `[unparseable]`/`[invalid]` markers. Wrap each tool with a `TEMPORARY_ERROR` result and still write the audit row. Add tests that use the real DOB and inject a repository failure. This lifts Standards (to about 8) and Tests (to about 9), and closes the Completeness gap on "every tool call audited".
2. **Bring the architecture docs up to date.** Update `docs/architecture.md` (status, ADR-0008, the call-token flow). Add an ADR for the call-token identity model, and record the PostgREST-client and calling-hours-default decisions. This lifts Architecture fit to about 8.5.
3. **Close the Medium items and restore the reference state.** Clean up in `smoke-webhook` and make `check-seed` assert seeded ids, so it goes green again. Add a minimal per-customer rate limit to `calls-api/authorize`, a shared `ErrorBoundary`, and a friendly-only `describeError`. Record when calling hours are switched back on (default on for the demo), and record the live pre-verification refusal in the M3 voice test. This lifts Completeness and Standards.

### Re-score after fixes

**Evaluator:** `evaluator` agent, 2026-11-02 (re-run). Scope: the same M0–M2 work plus the uncommitted CP1 fixes on `feature/M2-platform-tools` (`git diff HEAD`, plus untracked ADR-0009…0011 and `web/src/components/ErrorBoundary*.tsx`). I checked every fix against the code rather than the "Fixes applied" table. The original score above is kept as history.

#### Artifact check (re-run)

| Artifact | M0 | M1 | M2 |
|---|---|---|---|
| `docs/milestones/<M>.md` › Plan | Y | Y | Y |
| `docs/milestones/<M>.md` › Results (with test totals) | Y | Y | Y |
| `docs/reviews/CP1.md` › Code review | Y (verdict Warning; both Highs now fixed in code, see below) | | |

#### Commands re-run

| Command | Result |
|---|---|
| `npm run check` | **Exit 0.** Deno **123/123**, agent config **55/55**, web **33/33**. These match the counts claimed in "Fixes applied". Format, lint, typecheck, build, the bundle secret scan (6 secrets) and Deno fmt/lint/check all pass. Deno coverage: 99.7% lines and 98.3% branches overall. **100%** lines and branches on `registry.ts`, `verify-customer.ts`, every other tool, `guards.ts`, `compliance/*`, `vapi-webhook/handler.ts` and `calls-api/handler.ts`. Web: 96.4% lines, 89.4% branches. Agent config: 100%. |
| `npm run db:check-seed` (read-only) | **Passes.** 9/9 seed checks, plus the RLS anon block. It also reports "calls made while testing: 8". That fits the earlier count: 18 calls − 5 seeded = 13 test calls, plus 1 from the smoke run, minus the 6 smoke calls cleaned up = 8 left. |
| Read-only audit probe (Anita's voice-test calls, `tool_events`) | All 7 `verify_customer` rows store exactly `{"dob":"[redacted]"}`. I found **no** `lookup_loan` → `NOT_VERIFIED` row on any of Anita's voice calls (see the gap 7 row below). |

I did not run the smoke test or a deploy, as instructed. So the claims "functions redeployed" and "smoke 12/12 after the fixes" are not independently checked. The leftover-call count is consistent with a smoke run that used the new cleanup code.

#### Each issue checked against the code

| Issue | Verdict | What the code shows |
|---|---|---|
| **H1** DOB in audit | **Fixed** | `registry.ts` `defineTool`: when parsing fails it stores `'[invalid]'`; otherwise it stores `toAuditArgs(parsed.data)`, i.e. the Zod-stripped object, so extra keys are dropped. `verify_customer` always stores `{dob:'[redacted]'}`, and an unknown tool stores `'[unknown tool]'`. The `redact()` denylist is gone from `handler.ts`, and `audit()` writes `run.auditArgs` only. Tests use the real DOB: a truncated `{"dob":"…"`, a renamed `date_of_birth`, an extra `spokenDob`, and an extra `note` on a promise (`handler.test.ts`). The live DB agrees (probe above). |
| **H2** DB error → 500 | **Fixed** | Each handler runs inside `try/catch` in `defineTool`, which returns `TEMPORARY_ERROR` plus `failure`. `failure` holds the `RepositoryError` message (operation and code) or just the error name. `audit()` catches its own failure and logs it. The loop in `runToolCalls` always pushes one result per `toolCallId`. Tests cover: a DB error, a non-DB error (name only, DOB absent from logs), verify failing then lookup → `NOT_VERIFIED`, an audit failure that keeps the promise, and a non-Error throw. |
| **M1** lockout per call | **Fixed, with one new defect** | `recordVerification` is now compare-and-set (`verify_attempts=eq.<n-1>`, `return=representation`, returns a boolean), the same pattern as `claimCall`. A cap of `MAX_FAILED_VERIFY_ATTEMPTS_PER_DAY = 6` per customer is counted across unverified calls. **New defect:** the window starts at `istMidnight(ctx.now)`, and `ctx.now` follows the demo clock. `calls.started_at` is the real DB `now()`. If the demo clock is set to a later day, `since` is in the future, the count is 0 and the daily cap is silently off. An earlier demo day widens the window instead. The rate limit in `calls-api` uses real time on purpose for exactly this reason, but this cap does not. No test covers the cap with a demo clock set. It also contradicts ADR-0011, which says this cap "cannot be switched off". (The attempt-limit counts in `calls-api` have the same mismatch, but that predates the fixes.) |
| **M2** no rate limit | **Fixed** | `calls-api/handler.ts`: `RATE_LIMIT = {maxCalls: 3, windowMs: 60_000}`, counted from the real clock `deps.clock()` against `started_at`. It returns `RATE_LIMITED` (429) before `createCall`. Tests: the 4th call → 429 with no new row; calls from other customers or older than a minute are ignored. Count-then-insert is still not atomic, which is acceptable for a minimal limit. |
| **M3** smoke leaves rows | **Fixed** | `smoke-webhook.ts` `deleteSmokeRows()` in `finally`. The child-table list (`tool_events`, `promises`, `handoffs`, `customer_notes`, `call_results`, `followup_runs`) matches all 6 foreign keys to `calls` in the schema. `check-seed.ts` checks the seeded ids, and `db:check-seed` passes. Minor: the lookup `GET` does not check `response.ok`; if it fails, the script dies with an unclear error rather than a clear one. Also, if `setDemoSettings` in `finally` throws, the cleanup is skipped. |
| **M4** no error boundary | **Fixed** | `components/ErrorBoundary.tsx` wraps `VoiceSpikePage` in `App.tsx`. It shows a fixed message with `role="alert"` and never the error text, and has a path comment. The test checks that the error text is absent. |
| **L1** stale comments | **Fixed** | `handler.ts` L14 now reads "capped at 4 minutes". `config.toml` reads "no supabase-js, see ADR-0010". |
| **L2** architecture drift | **Fixed** | Status is M2 + CP1. The call-token flow, rate limit, allowlist audit and `TEMPORARY_ERROR` are described, and the ADR table runs to 0011. ADR-0009, ADR-0010 and ADR-0011 exist, each with context, alternatives and consequences. ADR-0011 records the switch-on point (M4 demo controls, M7 checklist). |
| **L3** raw SDK text | **Fixed** | `vapiClient.ts` always passes the fixed `CALL_ERROR_MESSAGE`. The test asserts that raw text is absent. |
| Evaluator gap 7 (live pre-verification refusal) | **Partly closed** | The M2.md voice-test row for Anita #3 was edited after the fact to say she asked "Do I owe you anything?" before verifying and was refused. The plan (smoke #1) expected "audit shows refusal". The audit trail for that call is `verify → verify → lookup ok → transfer`, with no `NOT_VERIFIED` row. So the live refusal happened at the prompt level (Asha never called the tool). The server-side refusal is proven only by unit tests and the deployed smoke test. The claim may be true, but the files cannot prove it. |
| Evaluator gap 8 (calling hours off) | **Closed** | ADR-0011 records the decision, the risk and the switch-on point. |

#### Scores (25% each)

| Criterion | Before | After | Evidence |
|---|---|---|---|
| **Architecture fit** | 7.0 | **8.5** | `architecture.md` now matches the built design. The three missing decisions have ADRs (0009 token identity, 0010 PostgREST client, 0011 switches). ADR-0002's "every tool writes a `tool_events` row" now holds on the failure path. New code reuses existing patterns: compare-and-set like `claimCall`, `RepositoryError` mapping, the injected `Repository` and its fake. **Held back by:** the daily DOB cap reads the demo clock while `started_at` is real time. This breaks ADR-0011's "cannot be switched off" claim and is inconsistent with the real-time choice made for the rate limit. |
| **Completeness** | 8.0 | **8.5** | All 9 review issues are addressed in code. The seed reference check is green again, and smoke runs clean up after themselves. Calling hours now have a recorded switch-on point. **Held back by:** the "live attempt" leg of "provably refused before verification" is a self-report added after the fact, with no audit row behind it (gap 7, partly closed). The 8 voice-test calls (with their promises and handoffs) still sit in the only database, so M3's "last promise" will read voice-test data for Anita and Ravi. |
| **Tests** | 8.0 | **9.0** | 211/211 pass on re-run, matching the claimed counts. 100% line and branch coverage on every critical area. The two gaps behind the H1/H2 findings now have real tests: the actual DOB in truncated, renamed and extra-key arguments; repository failures injected inside tools and inside the audit write; and a non-Error throw. Compare-and-set and cap-summing are tested at the PostgREST level, and the rate limit at its boundaries. **Held back by:** no test of the daily cap with a demo clock set (which is how the defect above got through). The smoke cleanup is only exercised live. |
| **Standards** | 6.5 | **8.5** | No Critical or High issues are open. Every security.md and coding-standards item the review flagged now passes: masked audit, per-tool error handling, rate limit, error boundary, friendly-only UI errors. Lint, format and typecheck are clean. New files have path comments, there is no `any`, no inline handlers, functions are under 50 lines, and files are under 800 lines. **Held back by:** (1) the demo-clock bypass of the daily DOB cap weakens a security.md BFSI rule (Low–Medium). (2) `vapi-webhook/handler.ts` `audit()` logs `error.message` for any `Error`, while the registry deliberately logs only the name for anything that is not a `RepositoryError`. A fetch `TypeError` or `TimeoutError` message ends up in logs. No personal data is in the paths seen, but it is inconsistent with the stated policy (Low). (3) `docs/BUILD-LOG.md` marks CP1 as 🟡 for a 7.4 score, which is Green (> 7), and has no entry for the fixes. |

#### Final (re-score)

| Arch | Complete | Tests | Standards | **Final** | **Rating** |
|---|---|---|---|---|---|
| 8.5 | 8.5 | 9.0 | 8.5 | **8.6 / 10** (was 7.4) | **Green** (> 7). Both Highs are fixed, so the condition for starting M3 (workflow.md › Checkpoints) is met once the fixes are committed. |

#### Remaining gaps

1. **New (from the M1 fix):** `verify-customer.ts` starts the daily DOB-cap window at `istMidnight(ctx.now)`, which follows the demo clock, but compares it with the real-time `started_at`. With the demo clock on a later day, the cap counts 0 and is off. Fix: use the real clock for this window, as the rate limit does (pass a real `now` into `ToolContext`, or compute the start from `deps.clock()`), and add a test with the demo clock set ahead.
2. `vapi-webhook/handler.ts` `audit()` logs `error.message` for errors that are not `RepositoryError`. Reuse the registry's `describeFailure` so the policy is the same everywhere (Low).
3. Gap 7 is only partly closed: the live pre-verification refusal has no audit row (Asha refused in speech without calling a tool). Record a live attempt in the M3 voice test where the refusal shows up in `tool_events`, or reword the M2 criterion to say that the live leg is a prompt-level refusal.
4. 8 voice-test calls and their promises and handoffs remain in the shared DB, and M3's "last promise" will read them. Decide at M3 whether to clean them up or treat them as realistic history.
5. `smoke-webhook.ts`: check `response.ok` on the leftover-call lookup, and make sure the cleanup runs even if restoring the demo settings fails (Low).
6. `docs/BUILD-LOG.md`: change the CP1 emoji to Green, and add a line for the fixes and the re-score.
7. The redeploy and the post-fix smoke 12/12 are not independently checked in this re-run (no deploy or smoke run, as instructed).

### Re-score findings fixed (coordinator, 2026-11-02)

| # | Finding | Fix |
|---|---|---|
| 1 | Daily DOB cap used the demo clock, so a demo clock set ahead skipped it | `ToolContext.realNow` (real clock) is used for the window; test with the demo clock a day ahead |
| 2 | `audit()` logged the full `error.message` | Uses the shared `describeFailure` (database errors: operation + code; anything else: name only) |
| 3 | Anita #3 row overstated the live refusal | Row reworded: refused in speech, no tool call; code-level refusal proven by the smoke test and unit tests |
| 5 | Smoke cleanup fragile | Checks `response.ok` on the lookup; runs even if restoring the settings fails |
| 6 | Build log status | CP1 entry updated to 8.6 |
| 4 | Voice-test rows remain in the database | Left for Saim to decide (they are real test history; M3 "last promise" would read them) |

After these: `npm run check` passes (Deno 124, agent 55, web 33), functions redeployed, webhook smoke 12/12 with cleanup.
