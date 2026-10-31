# SPEC — Suvidha Finance Voice Collections Agent

**Version:** 1.0 (prototype) · **Owner:** Saim · **Build window:** ~8 hours, finishing by Sunday
**Status:** Draft — awaiting "go ahead"

---

## 1. Summary

A mock client implementation for **Suvidha Finance**, a fictional Indian NBFC. A voice AI agent on **Vapi** calls overdue borrowers (simulated as browser calls), verifies identity, states dues from the loan system, negotiates a promise to pay, answers policy questions from a knowledge base, follows RBI fair-practice rules, and hands over to a human when needed — in **English, Hindi and Telugu**. Every call is saved with an audit trail, summarised, compliance-checked, and shown on a dashboard. Agent quality is measured with simulated text conversations and improved through a documented experiment.

**Why:** proves the GreyLabs *Platform FDE* "What success looks like" list — use case → working voice agent; prompts, logic, guardrails, test scenarios; requirements → go-live; structured improvement.

## 2. Goals and non-goals

**Goals**
- A working browser voice call in EN + HI (TE if it passes the M1 test)
- Tool calling against a fake loan system, with compliance enforced in code
- Grounded policy answers (RAG) with "I'll check with the team" fallback
- Post-call webhook → transcript, structured summary, compliance flags, audit trail
- ~24 eval scenarios with a v1 → v2 improvement round
- Client delivery pack: requirements, user stories, solution design, UAT, go-live checklist

**Non-goals (v1)**
- Real phone numbers or telephony (explained in docs only)
- Real payments, real customer data, WhatsApp/SMS
- Dashboard login, multi-tenant client config
- Memory of previous calls (v2)
- Voice-based automated evals (v2)

## 3. Users

| User | Needs |
|---|---|
| **Borrower** (played by Saim in the browser) | A clear, polite call in their language; a realistic way to pay or explain |
| **Collections manager** (client) | See outcomes, promises, escalations, compliance flags, agent quality |
| **Human agent** (client) | Receive escalated calls with a summary so the customer doesn't repeat themselves |
| **Compliance officer** (client) | Proof that RBI rules were followed on every call |

## 4. The call

### 4.1 Flow

```
Pre-call check (hours, attempts) ─► Greet + AI disclosure + recording notice
 ─► Confirm person (name) ─► wrong person? → apologise, end, reveal nothing
 ─► Verify (DOB) ─► fail ×2 → end politely
 ─► State dues (lookup_loan) ─► Listen for intent
 ─► Negotiate / answer / escalate ─► Recap agreement ─► Close
 ─► End-of-call webhook → summary + compliance check + save
```

### 4.2 Intents

| Intent | Agent behaviour |
|---|---|
| `will_pay` | Capture date, amount, mode → `log_promise_to_pay` → offer `send_payment_link` |
| `cannot_pay` | Empathise, ask reason, offer later date or part payment within policy |
| `already_paid` | Capture date/mode/reference → mark for verification → no pressure |
| `dispute` | Note the dispute → `transfer_to_human` |
| `wrong_person` | Apologise, reveal nothing, end |
| `wants_human` | `transfer_to_human` with summary |
| `policy_question` | `search_policy` → answer from docs, or "I'll check with the team" |

### 4.3 Entities

| Entity | Examples | Rules |
|---|---|---|
| `promise_date` | "Friday", "agle Monday", "వచ్చే సోమవారం", "15th" | Resolved to an ISO date; must be within policy window |
| `amount` | "full", "2000", "do hazaar", "half" | ≤ overdue amount; ≥ minimum part payment |
| `payment_mode` | UPI, net banking, debit card, branch | From allowed list |
| `delay_reason` | job loss, medical, salary late | Free text; `medical`/`job_loss` sets a hardship flag |

### 4.4 Conversation behaviours

- **Interruptions:** customer can talk over the agent; agent stops and listens (Vapi barge-in settings).
- **Fallback:** not understood → rephrase; 2 consecutive failures → offer a human.
- **Silence:** prompt once, then close politely.
- **Language:** call starts in the customer's preferred language; switches if the customer switches (EN↔HI mixing supported; TE switching is best effort).
- **Tone:** respectful, never threatening, never shaming.

### 4.5 Prompt framework (`agent/`)

Sections: **Persona** · **Objectives** · **Context** (injected customer first name + language only — no loan data until verified) · **Constraints** (compliance rules, amounts only from tools) · **Fallback** · **Escalation** · **Few-shot examples** (per language: verification, cannot-pay negotiation, wrong person, policy question not in docs).
The Vapi assistant configuration (model, voice, transcriber, tools, server URL) lives **as code** in `agent/` and is pushed to Vapi with a script — versioned, reviewable, reproducible.

## 5. Tools

All tools hit one Edge Function (`vapi-webhook`) that verifies the Vapi secret, dispatches by tool name via a lookup map, validates arguments with Zod, and logs every call to `tool_events`. **The customer is identified from the call's metadata, never from what the LLM says.**

| Tool | Args | Returns | Guard |
|---|---|---|---|
| `verify_customer` | `dob` | `verified: boolean`, attempts left | Max 2 attempts per call |
| `lookup_loan` | — | overdue amount, EMI, due date, days past due, late fee, last-4 loan no. | **Refuses unless verified** |
| `search_policy` | `query` | top passages + source, or `not_found` | Similarity threshold |
| `log_promise_to_pay` | `amount`, `promise_date`, `payment_mode` | confirmation id | Verified; amount and date within policy |
| `send_payment_link` | `amount` | fake link (`https://pay.suvidha.example/...`) | Verified; amount ≤ overdue |
| `transfer_to_human` | `reason`, `summary` | handoff id + closing line | Always allowed |

## 6. Knowledge base (RAG)

- Fake docs in `knowledge/`: **FAQ**, **fees and charges**, **collection and repayment policy** (part-payment minimum, max promise window, hardship options), **RBI fair-practice summary** (written in our own words).
- Chunked by section → Gemini embeddings → `policy_chunks` (pgvector).
- Answers only from retrieved passages; below threshold → "I'll check with the team and get back to you."

## 7. Compliance rules (code + tests at 100%)

| Rule | Where enforced |
|---|---|
| Calls only 08:00–19:00 IST | Pre-call check (`/v1/calls/authorize`) |
| Max attempts per customer (e.g. 3/day, 10/week) | Pre-call check |
| AI disclosure + recording notice in greeting | Prompt + post-call check |
| Verify before disclose | `lookup_loan` / payment tools refuse until verified |
| No disclosure to third parties | Wrong-person path + post-call check |
| No threats, abuse, shaming | Prompt constraints + post-call LLM check + evals |
| Amounts/dates only from tools | Prompt + post-call check (figures in transcript ⊆ tool results) |
| Full audit trail | `calls`, `tool_events`, `promises`, `handoffs` |

Demo note: the simulator has a visible **demo clock** so calling-hours rules can be shown at any real time.

## 8. Data model (fake data, RLS on all tables)

| Table | Key fields |
|---|---|
| `customers` | name, dob, masked phone, preferred_language, city |
| `loans` | customer_id, loan_number, product, emi, due_date, overdue_amount, days_past_due, late_fee |
| `calls` | customer_id, vapi_call_id, language, verified, attempt_no, outcome, intent, transcript, summary (jsonb), compliance_flags (jsonb), started/ended |
| `tool_events` | call_id, tool, args, result, timestamp |
| `promises` | call_id, loan_id, amount, promise_date, payment_mode, status |
| `handoffs` | call_id, reason, summary, status |
| `policy_chunks` | doc, section, content, embedding |
| `eval_runs` / `eval_results` | version, metrics; scenario, scores, transcript, pass |

Seed: ~8 customers across EN/HI/TE, varied situations (slightly late, long overdue, already paid, disputed).

## 9. Post-call processing

Vapi **end-of-call-report** → `vapi-webhook`:
1. Save transcript and timings.
2. Gemini produces a **`CallSummary`** (Zod-validated JSON): outcome, intent, entities, verified, sentiment, hardship flag, next action, handoff summary.
3. Rule-based + LLM **compliance check** → `compliance_flags`.
4. Dashboard updates.

## 10. Dashboard (dark UI)

| Page | Shows |
|---|---|
| **Call simulator** | Pick a fake customer → pre-call check result → start/stop browser call → live transcript |
| **Calls** | List with outcome, language, verified, flags |
| **Call detail** | Transcript, tool-call timeline (audit), summary, compliance flags |
| **Human queue** | Handoffs with summaries |
| **Promises** | Promises to pay with dates and amounts |
| **Evals** | Runs, metrics, v1 vs v2 comparison, per-scenario drill-down |

## 11. Evals

- **~24 scenarios**: 5 personas (cooperative, angry, confused, elderly, wrong person) × 7 intents × 3 languages, chosen to cover every intent and every language (roughly EN 10, HI 8, TE 6).
- **Runner (text, free Gemini):** customer-simulator LLM with a persona card and hidden facts ↔ agent LLM with the same prompt framework and the **same tool logic** (in-memory fake DB) → judge LLM with a rubric.
- **Metrics:** task completion · intent accuracy · entity accuracy · compliance (zero tolerance) · correct handoff · quality 1–5.
- **Experiment:** run v1 → analyse failures → change prompt/tools → run v2 → `docs/reports/evals-v2.md` with before/after.
- Throttled for free-tier rate limits.

## 12. Non-functional

- Agent response latency target: < 1.5 s typical (platform-dependent; measured in M1).
- Unit/integration coverage: 80% overall, 100% on money, identity, compliance, webhook auth, validation.
- Secrets in env only; webhook secret verified; RLS everywhere; no personal data in logs.

## 13. Setup — Saim does these (Claude can't create accounts)

| # | Task | When |
|---|---|---|
| 1 | Create a **Vapi** account (no card → spending can't exceed free credit). Copy public key + private key | Before M1 |
| 2 | Create a **Supabase** project (free). Copy project URL, anon key, service-role key | Before M0 build |
| 3 | Get a **Gemini API key** from Google AI Studio (free) | Before M1 |
| 4 | Create a **Vercel** account (free) | Before M6 |

Keys go into `.env` (local) and Supabase function secrets — never into chat or code.

## 14. Milestones (time-boxed, ~8 h)

Each milestone runs the **lean** pipeline in `guidelines/workflow.md`: plan stop → build + tests → quality gate + smoke test → results stop. Full review + scoring at **CP1** (after M2), **CP2** (after M4), **CP3** (end of M6).

### M0 — Foundation (45 min)
- Repo scaffold (`web/`, `supabase/`, `agent/`, `knowledge/`, `evals/`), lint/format/test tooling, `.env.example`
- `docs/architecture.md` + ADRs: Vapi, single webhook, Supabase, Gemini, verify-in-code
- Migrations + RLS + seed data
- `docs/delivery/requirements.md`, `user-stories.md`
- **Done when:** lint/typecheck/test commands run green on the empty scaffold; DB seeded in Supabase

### M1 — Voice spike + language test (45 min)
- Vapi assistant from config-as-code; browser call from a bare page
- Test EN, HI, TE: transcriber + voice quality, interruptions, latency; check Gemini can be used as the agent model with our own key
- **Done when:** a 1-minute call works in EN + HI; TE go/no-go recorded in an ADR with evidence

### M2 — Tools + compliance core (1 h 30)
- `vapi-webhook` with secret check, dispatch map, Zod validation, `tool_events` audit
- `verify_customer`, `lookup_loan`, `log_promise_to_pay`, `send_payment_link`, `transfer_to_human`
- Compliance rules + pre-call `/v1/calls/authorize` (TDD, 100% coverage)
- **Done when:** a voice call verifies, states real seeded dues, logs a promise; loan details provably refused before verification

### M3 — Conversation design + RAG (1 h 30)
- Full prompt framework + few-shots (EN/HI/TE), intents, entities, fallback, handoff
- Knowledge docs → chunks → embeddings → `search_policy`
- **Done when:** every intent works in a manual voice test; a policy question is answered from docs and an unknown one gets "I'll check with the team"

### M4 — Post-call + dashboard (1 h 30)
- End-of-call webhook → transcript, `CallSummary`, compliance flags
- Dashboard: simulator, calls, call detail, human queue, promises
- **Done when:** a finished call appears with summary, audit timeline and flags; a handoff shows in the queue

### M5 — Evals + improvement round (1 h 15)
- 24 scenarios, simulator, judge, runner; results to DB + Evals page
- v1 run → failure analysis → fixes → v2 run → report
- **Done when:** v1 and v2 results are visible with a before/after write-up

### M6 — Go-live pack (45 min)
- Deploy web to Vercel; final function deploy
- `docs/delivery/solution-design.md`, `uat-checklist.md` (executed), `go-live-checklist.md`, `telephony.md` (how this moves to real phone lines: SIP/number forwarding, consent, DLT, recording), `alternatives.md` (LangGraph / Retell, one page)
- README with demo script; Saim records a 3-minute demo video
- CP3: refactor → review → score
- **Done when:** live URL works end-to-end; CP1–CP3 scores on the scoreboard, all Green

**If time runs out:** cut in this order — E2E tests → Promises page → TE language → eval v2 round (keep v1 + failure analysis).

## 15. Risks

| Risk | Mitigation |
|---|---|
| Telugu speech/voice quality poor on Vapi | Tested first in M1; ships only if it passes; otherwise documented and moved to v2 |
| Vapi free credit smaller than expected (~$5) | Voice only for manual tests + demo; all bulk testing as text evals |
| Gemini free-tier rate limits during evals | Throttle; cheaper model for the customer simulator; cap turns per scenario |
| Gemini not usable as Vapi's agent model with own key | Fall back to Vapi's cheapest built-in model within credit; recorded in ADR |
| 8-hour window too tight | Time boxes + cut order above |

## 16. Job-description coverage

| JD item | Where |
|---|---|
| Prompts, prompt frameworks, few-shot | §4.5, M3 |
| Conversational flows, decision logic, guardrails | §4, §7, M2–M3 |
| Agents using tools / calling APIs, multi-step conversations | §5, M2 |
| Intents, entities, context, interruptions, fallback, handoff | §4.2–4.4 |
| Structured outputs, hallucination control | §9 CallSummary, amounts-from-tools rule |
| ASR, TTS, telephony | M1, `telephony.md` |
| Multiple languages | EN/HI/TE |
| RAG, vector DB, knowledge base | §6, M3 |
| APIs, JSON, webhooks, integrations | §5, §9 |
| Evaluation frameworks, test datasets, failure analysis | §11, M5 |
| BFSI compliance | §7 |
| Agent platforms (Vapi / Retell / LangGraph) | Vapi + `alternatives.md` |
| Discovery → POC → UAT → go-live; user stories; implementation docs | `docs/delivery/`, M0, M6 |
| Execution discipline | Plans, reports, reviews, scoreboard per milestone |
