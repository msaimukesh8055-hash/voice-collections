# CP3 — Checkpoint review (M6 → M9 + 2026-11-20 work)

**Scope:** everything changed since the CP2 merge `4f32c4d`, on branch `cp3-review`. Changes below are uncommitted.

## Refactor (refactorer)

```
Deleted:  5 unused exports/aliases · 0 files · 0 dependencies
Merged:   4 duplicate helpers (13 copies → 4) + 1 test fake split
Skipped:  10 items (reasons below)
Lines removed: ~50 net of dead/duplicate code (the fake split adds ~55 lines of function headers)
Tests: all passing (same counts before and after)
```

How it was found: a script listed every export and searched for it across the repo (TypeScript, JSON, Markdown), plus every file nobody imports, plus function names defined in more than one file. Unused files: none (every unimported file is a `package.json` script or a config entry point). Unused npm dependencies: none.

### Removed or merged

| File | What | Why it was safe |
|---|---|---|
| `supabase/functions/_shared/brain/llm.ts` | Removed `SARVAM_BRAIN_MODEL`, `GEMINI_BRAIN_MODEL` (aliases of `SARVAM_MODEL` / `GEMINI_MODEL`) and the re-exports of `GEMINI_URL`, `SARVAM_CHAT_URL`, `LLM_TIMEOUT_MS`. `llm.test.ts` now imports them from `_shared/llm/json-llm.ts` | Aliases added nothing; only the test used one, nothing used the rest |
| `supabase/functions/_shared/cards/schemas.ts` | Removed types `PickPayload`, `NewShopkeeperPayload` | Never imported; the schemas themselves stay |
| `voice-agents/schema.ts` | Removed types `AgentVariable`, `SarvamLanguage` | Never imported; schemas and agent config untouched |
| `web/src/features/dashboard/Layout.tsx` | Removed `PAGES` | Never imported; the nav uses the two page lists directly |
| `supabase/functions/_shared/db/postgrest.ts` | `totalFrom` (Content-Range count) now lives here once; removed the 3 identical copies in `supabase-repository.ts`, `supabase-owner-call-repository.ts`, `supabase-voice-action-repository.ts` | Byte-for-byte identical copies |
| `supabase/functions/_shared/db/book-repository.ts` | `newestFirst` (entry date, then written time) now lives next to `BookEntry`; removed the copies in `ledger/views.ts`, `ledger/waiting-views.ts`, `owner-tools/lookup-shopkeeper.ts`; `prepare-claim.ts` / `prepare-delete.ts` import it from here | Identical copies; same sort order everywhere |
| `supabase/functions/_shared/db/call-detail-rows.ts` (new) | One copy of the transcript columns (`TRANSCRIPT_FIELDS`), the tool-event row schema and `withoutToken`, shared by `supabase-dashboard-repository.ts` (Asha calls) and `supabase-owner-call-reads.ts` (Munshi calls) | Both had identical Zod shapes and mapping to the same `DashboardToolEvent` type; `call_token` is still stripped (test `supabase-dashboard-repository.test.ts` checks it) |
| `supabase/functions/_shared/log.ts` | New `errorName(error)` (log the error's class name only). Replaced 6 local `errorName`-style copies and 7 inline copies of `error instanceof Error ? error.name : 'unknown'` in `cards/actions.ts`, `cards/context.ts`, `followup/kick.ts`, `llm/json-llm.ts`, `ops/tracing.ts`, `sarvam-analytics.ts`, `speech/stt.ts`, `speech/translate.ts`, `speech/tts.ts`, `whatsapp/client.ts`, `whatsapp/media.ts`, `calls-api/sarvam-proxy.ts`, `whatsapp-webhook/handler.ts` | Same expression, same result; log fields unchanged |
| `supabase/functions/_shared/db/fake-repository.ts` + `eslint.config.ts` | Backlog #6 leftover: `createFakeRepository` (~130 lines in one function) split into `fakeCallReads`, `fakeCallWrites`, `fakePromises`, `fakeLedgerAndEvents` (plus the existing `fakeMemory`). The file's exemption from the 50-line rule is removed from `eslint.config.ts` | Test fake only; same methods, same shared state object; ESLint passes on it without the exemption; all 1,569 Deno tests and the eval fixture that use it pass |

No agent prompt, greeting, tool reply wording, WhatsApp text, migration or seed was touched.

### Not removed, and why

| Item | Reason |
|---|---|
| `scripts/seed/generate-seed.ts` `SHOPKEEPER_COUNT` | Dead (the count comes from `PROFILE_COUNTS`), but it is in the seed generator and predates CP2; left with the seed |
| `_shared/env.ts` `loadServerEnv` | Only tests use it, but it is env handling (danger tier) and its tests cover the base env schema every function uses |
| `_shared/followup/prompts.ts` `FOLLOWUP_PROMPT_VERSION` | Prompt territory (owner's decision) |
| `_shared/calls/memory.ts` `EMPTY_MEMORY` | Only tests use it; it documents the empty-memory shape. Low value, unsure |
| `evals/sarvam/munshi-cases.ts` `MUNSHI_WRAP_UP_AGO_MS`, `_shared/whatsapp/signature.ts` `signBody` | Exported for tests on purpose |
| `sha256` (3 copies) and `toHex` (2) in `auth/bearer.ts`, `whatsapp/sender.ts`, `whatsapp-webhook/handler.ts`, `whatsapp/signature.ts` | Webhook / bearer auth code; identical, but left alone so the auth path is not reshuffled before go-live. Good candidate for a later small `_shared/auth/digest.ts` |
| `requireEnv` (6 copies in `scripts/`) | Scripts include `db-push` and `functions-deploy` (live systems); one copy (`scripts/lib/smoke.ts`) also strips `\r`, so they are not exactly the same |
| `argAfter` (3 copies in eval CLIs) | Three-line helper in CLI entry points; a shared module is not worth it |
| `tools/define.ts` error name | Says `'unknown error'`, not `'unknown'`; merging would change a log value |
| ~300 exports used only inside their own file | Only the `export` keyword is unneeded; removing it is churn with no real gain |

Stale comments: searched code for Vapi, "no longer", legacy, TODO and similar. The "no longer" comments found are still true (for example, Asha does not read the follow-up note; `views.ts` says so correctly). Nothing removed.

Backlog note for the coordinator: item 6 in `docs/reviews/review-backlog.md` ("Still open: fake-repository.ts exempt…") can be marked fixed. I did not edit the backlog.

### Tests and gate

| Suite | Before | After |
|---|---|---|
| Root Vitest (evals, scripts, voice-agents) | 315 passed / 27 files | 315 passed / 27 files |
| Web Vitest | 283 passed / 25 files | 283 passed / 25 files |
| Deno (`supabase/functions`) | 1,569 passed, 0 failed | 1,569 passed, 0 failed |

These are the refactor's counts. After the review fixes below (new tests added): root 317, web 283, Deno 1,573, all passing.

Each change was checked on its own (typecheck, lint, format, the affected tests) before the next. Final `npm run check` (format, lint, typecheck, tests with coverage, build, bundle secret check, `deno fmt`, `deno lint`, `deno check`, `deno test`): **exit 0**.

## Code review (reviewer)

Run as three reviewers in parallel (security and money paths; evals, CI and web; backend logic), because one reviewer over the whole diff stalled. Their full cards, with file:line and scenario, are kept next to this file: `CP3-part-security.md`, `CP3-part-evals-web.md`, `CP3-part-backend.md`.

**Verdict: Warning → Approve after fixes.** 0 Critical. 4 High, all fixed (B-H2 after Saim chose "drop just the unchecked line").

### Fixed in this review (plain code, with a test each)

| Id | Sev | What was wrong | Fix |
|---|---|---|---|
| S-H1 | High | Munshi's 1.5 s grace wait ran before the new change was stamped, so the change looked 1.5 s older and the 2 s "no yes yet" lock was mostly bypassed | Owner tools get a fresh `clock()`; a stored change is dated after the wait (`owner-tools/actions.ts`, test in `confirm-race.test.ts`) |
| E-H1 | High | The Sarvam release gate could pass with a case Sarvam never judged | A case with no Guardrails verdict now fails the gate: "N case(s) not judged by Sarvam" (`evals/sarvam/gate.ts`, test in `logic.test.ts`) |
| B-H1 | High | `/pause` stopped new calls but not simulated calls already queued (after "Remind all due"); they still ran and messaged the owner | The queue checks the pause switch before starting a call; held calls stay queued and the every-minute sweep starts them after `/resume` (`simulator/run.ts`, test in `run.test.ts`) |
| E-M2 | Medium | The Asha gate runner still used this computer's clock (the Munshi runner was fixed on 2026-11-20) | Both runners share `serverClock()` in `evals/sarvam/server-clock.ts` |
| E-M3 | Medium | The Evals workflow gave every secret to the whole job, including `npm ci` | Secrets are set only on the step that runs each eval (`.github/workflows/evals.yml`) |
| E-M4 | Medium | A "start run" POST with no reply was resent, which could start a second paid Sarvam run | Only reads are resent after no reply; a 429 is still waited out (`evals/sarvam/client.ts`, test in `io.test.ts`) |
| E-L1 | Low | The Munshi gate could not run from the Evals workflow | `munshi` target added; the version input is now `agent_version` for both agents |
| B-L2 | Low | A failed message-log write in owner-send stopped the rest of the replies going out | The log write's failure is logged and the send carries on (`reminders/owner-send.ts`, test added) |
| B-H2 | High | The after-call WhatsApp summary sent 2–3 LLM-written "Summary" lines with no code check of their figures | Saim's call (2026-11-20): drop just the unchecked line. A line is kept only when every figure in it is the saved promise, the claim, today, or said on the call; a figure in words drops its line (`followup/said-check.ts`, tests in `said-check.test.ts`) |

### Left for Saim (owner decisions or product behaviour)

| Id | Sev | Issue | Why it waits |
|---|---|---|---|
| S-M1 | Medium | If a confirm's write times out, the action is reopened; with no idempotency key a second "yes" could save the same payment twice | Needs a database migration (a unique key per action), which this unattended run may not do |
| S-M2 | Medium | With `DASHBOARD_PUBLIC` on, `POST /v1/dashboard/test-drafts` is open to anyone, with no rate limit; the threat model does not mention it | Keep it open for the demo, or put it behind the operator key |
| E-M1 | Medium | `--only` / `--resume` runs are stored and shown as "Release gate passed" | Whether a partial run may ever count as the gate |
| B-M1 | Medium | When Saaras says `en` for Latin-letter Hindi or Telugu, the card follows the words but the Heard line and voice reply stay English | Which language should win is a product choice |
| B-L1 | Low | The failure alert can fire twice for one error (sliding 15-minute look-back, fixed 15-minute "already alerted" slots) | Fix needs a small choice of window rule; harmless meanwhile (one extra alert) |
| B-L3 | Low | The scorecard's "Inside calling hours" check uses the real clock; the pre-call check uses the demo clock and the on/off switch, so allowed test calls get a false warning | The scorecard does not know the clock settings at call time; needs those saved with the call |

### Backlog items closed in this checkpoint

8 (Vapi gone from the guidelines), 11 (ADR-0011 says which clock each rule uses), 12 (`smoke-tools.ts` uses `scripts/lib/smoke.ts`), 13 (M3/M4/M5 status lines; CP2 fixes recorded in M5.md), 14 (a failed score read no longer breaks the lookup; the score line is left out). Item 6's leftover (fake-repository split) was done by the refactorer.

No agent prompt, agent or WhatsApp wording, migration, seed or live system was touched; no Sarvam run was started.

## Score (evaluator)

**Re-score, 2026-11-20, after the docs fixes** (no code changed since the first score of 7.25). Only what the files show; workflow.md › Scoring, four criteria at 25% each.

**Artifacts checked**

| Artifact | Found |
|---|---|
| M6 / M7 / M8 / M9 Plan sections | Y / Y (A, B1, B2) / Y / Y (+ Build F, Build G) |
| M6 / M7 / M8 / M9 Results with test totals | Y / Y / Y (C3 added, written at CP3) / Y (Build G added) |
| 2026-11-20 work: plan + results | Y (M9 Build G, recorded after the fact) + ADR-0020, ADR-0021 |
| CP3 review (refactor + code review, 3 part cards) | Y, verdict Approve after fixes (not Block) |

**Tests re-run here:** root Vitest 317/317, web 283/283, Deno 1,573/0 failed (the CP3 table above still says 315 and 1,569; the BUILD-LOG's 317 + 283 + 1,573 is right). Deno coverage re-measured: 229 function files, mean line coverage 99.5%, none under 80%; `owner-tools/confirm-action`, `prepare-payment`, `prepare-claim`, `actions` (grace wait), `compliance/*` and `whatsapp-webhook/*` at 100% lines.

**Docs checked against code and records:** `committedVersion` 7 (Asha) and 3 (Munshi) match; `PROMPT_VERSION` v9 / v3 match; `REPLACE_GRACE_MS = 1_500`, `REPLACED_NOT_SAVED`, the confirm-alone line in `read-back.ts`, claim matching, `HEALTH_CALLS = 50`, `TREND_DAYS = 14`, unjudged-fails-gate in `gate.ts`, the four `20261120*` migrations (additive, RLS on, no policies) all match. Inaccuracies:
1. ADR-0021 says both gate runners refresh call clocks on a 15 s timer; only the Munshi runner does (`munshi-runner.ts` `CLOCK_REFRESH_MS`); Asha's runner only reads server time.
2. `architecture.md` data model leaves out `20261116000001_ops_skip_eval` (eval traffic out of `ops_summary`) and the `eval_agent` / `eval_run` columns.
3. M9 Build G "Commits" leaves out the other 2026-11-20 commits (`7957483` / `a558250` Asha v9, `a7e6913`, `86e5acb`, `68bf66e`, `4a3c564`).
4. The Asha v8 6/9 result and eval run `4780a8ef` are recorded only in M9.md (no results file or BUILD-LOG line); v9's 9/9 is backed by commit `7957483`'s message.
5. Code comment, not a doc: `voice-agents/munshi/prompt.ts` header still says "Munshi prompt v2" while `PROMPT_VERSION` is v3.

| Criterion | Score | Evidence | Still holding it down |
|---|---|---|---|
| Architecture fit | 7.0 → 8.0 | `architecture.md` now current (CP3 status, live-evals section, grace wait, M9 + 2026-11-20 migrations, test-drafts security note, ADR table to 0021); ADR-0020/0021 match the code | Inaccuracies 1–2; B-H2 (LLM figures reach WhatsApp unchecked, against ADR-0014's code-first rule) |
| Completeness | 6.5 → 7.5 | M8 C3 Results and M9 Build G written; Asha gate owed since 2026-11-12 now recorded (v9 9/9, committed v7); Munshi gate 16/16 | `lookup_shopkeeper` p95 597 ms over the < 500 ms target; no scripted C3 smoke; rollback rehearsal and platform feedback doc not done (Saim's choice, still undelivered scope) |
| Tests | 8.0 → 8.5 | All suites pass on re-run; Deno coverage now shown, critical money/confirm/compliance/webhook files 100% | No coverage thresholds in config, so the gate does not enforce 80% / 100%; no Playwright E2E though `testing.md` lists it; CP3 table counts stale |
| Standards | 7.5 → 7.5 | Unchanged code: 0 Critical, path comments, no `any`, no inline JSX handlers | B-H2 (High), S-M1 (double save on a timed-out confirm), S-M2 still not in `threat-model.md` |

**Final: (8.0 + 7.5 + 8.5 + 7.5) / 4 = 7.88 → Green** (was 7.25).

**Gaps:** B-H2 / S-M1 / S-M2 open · `lookup_shopkeeper` p95 over target · rollback not rehearsed, no platform feedback doc · no enforced coverage thresholds · doc inaccuracies 1–4 above.
