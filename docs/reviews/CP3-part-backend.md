# CP3 review — backend logic (part)

Scope: supabase/functions/_shared (excluding owner-tools/ and auth/), followup-worker/, whatsapp-webhook/ routing. Diff base 4f32c4d.

## Findings

### B-M1 · Medium · Voice note heard as "en" but answered in Hindi/Telugu: Heard line and voice reply stay English
- **File:** `supabase/functions/whatsapp-webhook/route.ts:L119-L131` (with `replyLanguage` L52-L55)
- **What:** dry-run fix 3 makes the *card* follow the words when Saaras reports `en` for Latin-letter Hindi/Telugu, but `routeVoice` still uses the raw `heard.language` for the Heard line (`heardLine(heard.text, heard.language)`) and for `speakIn`. The resolved reply language is never passed back out of `routeText`.
- **Scenario:** owner says "Ramesh ne 1,000 rupaye diye"; Saaras says `en`. Text reply: "🎤 Heard: …" (English) on top of a Devanagari "*भुगतान मिला*" card; the voice reply is summarised and spoken with `language='en'`. If the summary fails, `spokenText(replies,'en')` hands Devanagari card lines to the English Bulbul voice. The route-dryrun test checks only the card text, so this passes.
- **Fix:** have `routeText` return the language it replied in (e.g. `Outcome.language`), and use it for `heardLine` and `speakIn` in `routeVoice`.
- **Owner decision** (which language the spoken reply uses for Hinglish voice notes).

### B-H1 · High · `/pause` does not stop calls already queued: the simulator keeps starting them
- **File:** `supabase/functions/_shared/simulator/run.ts:L193-L213` (`runNextSimulation`); pause is checked only in `calls/queue.ts:L67` and `compliance/precall.ts:L45`
- **What:** the pause switch is checked when a call is *queued* (pre-call check), never when a queued simulated call is *started*. `runNextSimulation` claims the oldest queued call with no look at `demo_settings.calls_paused`, and `claim_simulated_call` (migration 20261106000001) does not check it either. M9 Plan B1 says "Calls in progress finish; queued ones wait"; the `/pause` reply tells the owner "No new call will start".
- **Scenario:** owner taps "Remind all due" (30 people queued, 4 run at a time), then sends `/pause`. Each finished call runs `startNext()`, and the every-minute sweep wakes the queue, so all 26 waiting calls still run. Each one makes LLM calls, writes a follow-up and sends the owner a WhatsApp summary, after he was told calls had stopped. No test covers pause plus a queued call.
- **Fix:** in `runNextSimulation`, read `getDemoSettings()` before `claimSimulatedCall` and return `'idle'` when `callsPaused` is true (queued rows stay queued and resume on `/resume` via the sweep). Add a test.
- **Plain code fix** (matches the approved B1 behaviour).

### B-H2 · High · LLM-written summary lines reach the owner's WhatsApp with no code check on amounts or dates
- **File:** `supabase/functions/_shared/followup/note.ts:L59-L68` (`parseSaid`) → `followup/summary.ts:L205-L209` (`saidLines`) → `followup/after-commit.ts:L62-L74`
- **What:** prompt v2/v3 asks the LLM for 2–3 "Summary" lines that include "a promise with its amount and date, a payment they say they made". `parseSaid` only trims, cuts the length and checks the script; nothing compares the amounts or dates in those lines with `facts.promise`, `facts.claim` or the transcript before `buildSummary` sends them. The only guard is the prompt line "Never add amounts or dates that are not there" (rule: amounts and dates must come from records, coding-standards / reviewer checklist "Amount or date not sourced from a tool result"). The call scorecard's `summary_matches` check (`calls/scorecard.ts:L492-L509`) finds a wrong figure only *after* the message has gone.
- **Scenario:** the problem v3 was written for (a live call: an earlier ₹1,500 offer listed as a second payment next to the final ₹2,000) happens again, or the LLM misreads "15 tareekh" as the 5th. The owner gets "Result: Promised ₹2,000 by 25 Nov" (from code) followed by "• Paid ₹1,500, will pay ₹2,000 on 5 Nov" (from the LLM) and may chase or count a payment that never happened. Telugu/Hindi lines are not even checked against the English ones.
- **Fix:** run each `said` line (en and owner) through a code check like the M7 spoken-summary check (`whatsapp/spoken-check.ts`): every amount in it must be the final promise, the claim, or an amount the shopkeeper said (`scorecard-amounts.ts` `amountsIn` already does this); drop the line, or drop the whole Summary block, if not. Same for an owner-language line whose amounts differ from its English line. Log `summary_line_dropped` (count only).
- **Plain code fix** (wording unchanged; only unsafe lines are dropped). Whether to drop one line or the whole block is a small **owner decision**.

### B-L1 · Low · Failure alert can fire twice for one error (look-back window and claim window are not aligned)
- **File:** `supabase/functions/_shared/ops/watch.ts:L85-L116`
- **What:** each run looks back a sliding 15 minutes (`since = now - 15 min`), but the "already alerted" claim key uses a fixed clock-aligned bucket (`floor(now / 15 min)`). An error in the first 10 minutes of a bucket is still inside the next bucket's look-back.
- **Scenario:** one failure at 10:08. The 10:10 run claims bucket 10:00 and alerts. The 10:15 run looks back to 10:00, sees the same error, claims the new bucket 10:15 and alerts again. One error, two WhatsApp alerts. The file header promises "one message, not fifty"; this is two, not one.
- **Fix:** look back only to the start of the current bucket (`since = window * ALERT_WINDOW_MS`), or since the last run (5 min); or claim per trace id instead of per bucket.
- **Plain code fix.**

### B-L2 · Low · Owner-send: a failed message-log write stops the rest of the messages going out
- **File:** `supabase/functions/_shared/reminders/owner-send.ts:L148-L159` (`send`)
- **What:** `recordOutbound` is awaited with no `.catch`, inside the loop over replies. The webhook's `sendAll` (`whatsapp-webhook/process.ts:L77-L84`) catches the same write and logs `outbound_log_failed`.
- **Scenario:** owner tells Munshi "send me pending". The action is already `done` (once only). Reply 1 (pending text) goes out, its log write hits a database blip, and the error ends the job (`worker_job_failed`). Reply 2 (the "Open a shopkeeper" list) is never sent and never retried, though Munshi said it was sent.
- **Fix:** catch and log the `recordOutbound` failure as `process.ts` does, so every reply is still sent.
- **Plain code fix.**

### B-L3 · Low · Scorecard "Inside calling hours" uses the real clock; the pre-call check uses the demo clock and the on/off switch
- **File:** `supabase/functions/_shared/calls/scorecard.ts:L218-L226` (`callingHours`)
- **What:** the check reads `istHour(queuedAt)` (real time) against 08:00–19:00. The rule it reports on (`compliance/precall.ts`, `calls/queue.ts:L82`) uses the demo clock and `callingHoursEnabled` (ADR-0011). The scorecard knows neither.
- **Scenario:** Saim tests at 22:00 with the demo clock set to 11:00 (or calling hours switched off for testing). The call was allowed, but its report and the Agent health page show a Guardrails warning "22:00 IST", and that warning counts toward the `check` verdict. Health trends then show guardrail noise that is not real.
- **Fix:** store the pre-call decision's hour/flag on the call (or the `call_authorised` step), and score that. Or mark the check `na` when the demo clock or the switch was in use.
- **Plain code fix.**

## Checked and fine (no card)
- Refactor: `totalFrom`, `newestFirst`, `call-detail-rows.ts` (`call_token` still stripped, same Zod shapes), `errorName` (same expression, same log values), `fake-repository.ts` split (same methods on one shared state).
- Follow-up worker door: secret checked before routing, UUID ids, typed job map, background errors logged by code only.
- Timeouts on every external call in scope: LLM 8 s, STT/TTS 15 s, Translate 6 s, Meta media 10 s, Sarvam analytics 10 s, worker kick 10 s, WhatsApp send.
- Logs, now also written to `ops_events`: fields are ids, counts, codes and masked sender hashes. No text, names, numbers or amounts found.
- Money maths: `creditStates` shared by dues and insights (paise, oldest first, confirmed only); `keepsWrittenAmount` and the Hindi "ने … दिए" reader only take amounts that were written; the card Save keeps its compare-and-set.

## Verdict
**Warning.** No Critical. Two High: `/pause` does not stop queued simulated calls (B-H1), and unchecked LLM figures in the owner's after-call summary (B-H2). Fix both before go-live. One Medium, three Low.
