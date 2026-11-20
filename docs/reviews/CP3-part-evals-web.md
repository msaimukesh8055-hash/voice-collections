# CP3 review — part: evals, scripts, web, CI

Scope: `git diff 4f32c4d` on evals/, scripts/, web/src/, .github/workflows/, voice-agents/ build code. Reviewer: code-review agent (read-only).

## Findings

### E-H1 · High · Release gate can pass with a case that was never judged
- **File:** `evals/sarvam/gate.ts:L24-L56` (with `evals/sarvam/runner.ts:L114-L127`)
- **What:** `resultFor` correctly marks a case with zero Sarvam verdicts as `passed: false`, but `summarise`/`reasonsFor` never look at `casesPassed`. A no-verdict case adds 0 behaviours and 0 guardrail verdicts, so it is invisible to every gate rule. Same for a case that returns behaviour verdicts but no `Guardrails` verdict: its guardrails are simply not counted.
- **Failure scenario:** Sarvam's judge errors on `asha-07` (the third-party-disclosure case) and returns an execution with no verdicts; its DB checks pass (no tools ran). The other 8 cases pass. Table prints `FAIL asha-07 ... no verdicts returned` but also `GATE PASSED`, exit code 0, and the Evals page shows "Release gate passed" with 8/9 cases. The one case that guards disclosure was never graded.
- **Suggested fix:** In `reasonsFor`, add a reason for every case with `verdicts.length === 0` (and for any case missing a `Guardrails` verdict when guardrails were configured); add a `logic.test.ts` case for it. The Munshi runner shares `summarise`, so check it gets the same rule.
- **Owner decision:** plain code fix (it tightens the gate Saim already defined: "every guardrail verdict passes").

### E-M1 · Medium · `--resume` and `--only` runs are stored and shown as "Release gate passed"
- **File:** `evals/sarvam/runner.ts:L191-L195`, `evals/sarvam/run.ts:L233-L238, L302-L318`, `evals/sarvam/munshi-run.ts` (`chosenCases`); shown by `web/src/features/evals/EvalsPage.tsx:L28-L36, L113-L117`
- **What:** `resumeRun` silently drops every case whose call token it cannot match (`known = cases.filter(...)`), and `--only` runs a subset; both then go through the full `summarise` and `saveRun`. The stored row has no "partial" marker, and the Evals page prints "Release gate passed" from `metrics.passed`.
- **Failure scenario:** a resumed run where 3 of 9 suite cases no longer resolve (row deleted by `evals:cleanup`, or a different suite id typed) is judged on 6 cases, passes, exits 0 and appears on the Evals page as a passed release gate for that agent version. Same for `--only asha-03`.
- **Suggested fix:** store `casesPlanned` (the full case list length) and `partial: true` when `results.length < ALL_CASES.length`; make `reasonsFor` fail (or the page label "partial run, not a release gate") in that case; print the dropped case ids on resume.
- **Owner decision:** plain code fix (labelling); whether a partial run may ever count as a gate is Saim's call.

### E-M2 · Medium · Asha runner did not get the clock fixes the Munshi runner got
- **File:** `evals/sarvam/run.ts:L279-L283`, `evals/sarvam/eval-data.ts:L84-L92`, `evals/sarvam/runner.ts:L151-L168`
- **What:** Munshi now dates eval calls by the database server's clock (`server-clock.ts`) and keeps resetting the call clock while Sarvam queues the run (`refreshCallClocks`), because both problems made tokens expire (2026-11-20). Asha's runner still stamps `accepted_at` with this PC's `new Date()` and never refreshes it, although Asha's tools apply the same 10-minute window.
- **Failure scenario:** with the PC 4 minutes slow (as on 2026-11-20) or a Sarvam queue of a few minutes, Asha cases start already near or past the 10-minute window; tools refuse, `must_call`/`promises_saved` fail, and a good prompt version fails the gate (false fail, wasted paid run).
- **Suggested fix:** use `serverClockOffsetMs`/`offsetClock` in `run.ts`, and reuse the Munshi clock-refresh loop (PATCH `calls.accepted_at` for the run's ids while waiting).
- **Owner decision:** plain code fix.

### E-M3 · Medium · Evals workflow gives the service-role key to `npm ci`
- **File:** `.github/workflows/evals.yml:L30-L45`
- **What:** all eight secrets, including `SUPABASE_SERVICE_ROLE_KEY` (full database access, bypasses RLS) and the Sarvam/Gemini keys, are set at **job** level, so they are in the environment of `npm ci` and every dependency's install script.
- **Failure scenario:** one compromised or typo-squatted package in the lockfile tree runs a `postinstall` that reads `process.env.SUPABASE_SERVICE_ROLE_KEY` and sends it out; the attacker can then read or wipe the whole book. (`guidelines/security.md`, secrets.)
- **Suggested fix:** move the `env:` block onto the two eval steps only (each step gets just the keys it needs), and use `npm ci --ignore-scripts` if nothing needs install scripts.
- **Owner decision:** plain code fix.

### E-L1 · Low · The Munshi release gate cannot run from the Evals workflow
- **File:** `.github/workflows/evals.yml:L12-L53`
- **What:** the `target` choice is `brain | asha`; there is no `munshi` option and no `SARVAM_MUNSHI_APP_ID` secret, though `evals/sarvam/munshi-run.ts` is now a release gate (Munshi gate run 5 passed 16/16 locally).
- **Failure scenario:** the Munshi gate can only be run from one laptop (the one whose clock was 4 minutes off), so "every release passes the gate in CI" is not true for Munshi.
- **Suggested fix:** add a `munshi` option with a `munshi_version` input and a step running `node evals/sarvam/munshi-run.ts --version "$MUNSHI_VERSION"` with step-level env.
- **Owner decision:** plain code fix.

### E-M4 · Medium · A timed-out "start run" is retried, which can start (and pay for) a second run
- **File:** `evals/sarvam/client.ts:L150-L172` (used by `startRun` L229 and `createSuite` L213)
- **What:** `call` treats any missing reply (including the 30 s `AbortSignal.timeout`) as "network down" and repeats the request up to 3 times. That is safe for GETs, but `start run` and `create suite` are POSTs that are not idempotent: if Sarvam received the first POST and only the reply was slow or lost, the retry starts a second run.
- **Failure scenario:** Sarvam takes 35 s to answer `start run` for the 16-case Munshi suite; the runner aborts, retries, and gets a second run id. Both runs execute (two lots of paid conversations, both hitting the same eval tokens at once, so tool calls from run 1 can land in the evidence read for run 2 and fail or skew the DB checks). Only run 2 is collected.
- **Suggested fix:** do not retry POSTs on a missing reply (only on 429); on a lost `start run` reply, list the suite's runs and pick up the one just created, or stop and tell the operator to use `--resume`.
- **Owner decision:** plain code fix (budget-relevant: CLAUDE.md budget guardrails).

## Checked and found sound (no card)

- `scripts/evals-cleanup.ts` + `scripts/lib/eval-cleanup.ts` + `delete_eval_owner`: reads only `is_eval=eq.true` owners, refuses the whole plan if any unflagged owner appears, and the SQL function re-checks `is_eval` per owner inside its own transaction; dry run is the default. It cannot reach the real owner's book.
- `evals/sarvam/eval-db.ts`, `munshi-eval-db.ts`: insert-only plus PATCHes scoped by the run's own ids and `status=in.(accepted,in_progress)`; no deletes; every eval owner row sets `is_eval: true`, `eval_agent`, `eval_run`.
- `evals/sarvam/checks.ts`, `munshi-checks.ts`: money and identity checks are critical and fail safe (missing balance row gives `NaN`, which fails `balance_unchanged`).
- `evals/munshi/report.ts` (text evals) already fails when a scenario was not judged (`judged X of Y`); only the Sarvam gate lacks the equivalent (E-H1).
- Scripts (`db-push`, `functions-deploy`, `agent-build`, smoke scripts) print names, statuses and ids only; secrets go through env or a 0600 temp file that is removed.
- Web: no `dangerouslySetInnerHTML`, no `any`, no `console.log`, no inline JSX handlers, file path header on every changed file, sizes within the ESLint limits; colours stay on the light-blue tokens (amber only in the approved console strip; three chart hex colours in `Donut.tsx`). Dynamic links are built from route constants plus `encodeURIComponent` ids.
- CI (`ci.yml`): runs the full `npm run check` with no secrets and `contents: read`.

## Verdict (this part)

**Warning**: 0 Critical, 1 High (E-H1, the Sarvam release gate can pass with an unjudged case), 4 Medium, 1 Low. No eval or cleanup path can touch the real owner's data.
