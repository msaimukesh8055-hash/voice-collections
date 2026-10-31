# SPEC — Suvidha Finance Voice AI Programme

**Version:** 1.2 (prototype) · **Owner:** Saim · **Build window:** Saturday + Sunday (~9–10 h core)
**Status:** Draft — awaiting "go ahead"

---

## 1. Summary

A mock client implementation for **Suvidha Finance**, a fictional Indian NBFC, built on a small reusable voice-agent platform on **Vapi**.

**Core (must ship)**
1. **Collections voice agent** — calls overdue borrowers (browser call), verifies identity, states dues, recalls previous calls, negotiates a promise to pay, answers policy questions from a knowledge base, follows RBI fair-practice rules, hands over to a human when needed. English + Hindi.
2. **Follow-up agent** — takes over after every call. Rules handle clear cases; the agent handles judgement calls (e.g. genuine hardship vs stalling). It acts with tools — schedules follow-ups, creates human handoffs, marks do-not-call — and **always writes a note** that the voice agent reads on the next call.
3. **Dashboard** — KPIs, customers, call simulator, transcripts, audit trail, follow-up decisions, human queue, evals.
4. **Evals + release gate** — simulated conversations with hallucination and consistency checks, an experiment log, and a gate that blocks publishing a worse agent.

**Pending (only after the core works)**
5. **Lead qualification voice agent** — second use case on the same platform (§7).

**Why:** Saim's main portfolio piece for the GreyLabs AI *Platform FDE* role — use case → working voice agent; prompts, logic, guardrails, test scenarios; a genuine agent-to-agent handover; requirements → go-live; structured improvement.

## 2. Goals and non-goals

**Goals**
- Working browser voice calls in English and Hindi (incl. Hinglish)
- Tool calling against a fake loan system, with compliance enforced in code
- Context retention within and across calls via follow-up notes
- Grounded policy answers (RAG) with "I'll check with the team" fallback
- Voice agent → follow-up agent handover (multi-agent workflow)
- Evals with hallucination + consistency checks, experiment log, release gate
- Polished light-blue dashboard with business KPIs
- Client delivery pack: requirements, user stories, solution design, UAT, go-live checklist

**Non-goals (v1)**
- Telugu or other languages (documented as a v2 extension)
- Onboarding use case
- Real phone numbers or telephony (explained in docs only)
- Real payments, real customer data, WhatsApp/SMS
- Dashboard login, multi-tenant config UI
- Multi-agent handovers *inside* a live call (Vapi Squads) — documented trade-off

## 3. Users

| User | Needs |
|---|---|
| **Borrower** (played by Saim in the browser) | A clear, polite call in their language |
| **Collections manager** | Outcomes, promises, follow-ups, escalations, compliance, KPIs |
| **Human agent** | Escalated cases with a summary so the customer doesn't repeat themselves |
| **Compliance officer** | Proof that rules were followed on every call |

## 4. Platform (shared)

Each voice use case is a folder `agent/<use-case>/` holding **config as code**: prompt framework, few-shot examples (EN + HI), tool list, post-call schema, eval scenarios, KPI definitions. Shared pieces:

| Shared piece | What it does |
|---|---|
| **Tool registry** | One webhook; tools in a typed map; each use case enables a subset |
| **Compliance engine** | Calling hours, attempt limits, verify-before-disclose, do-not-call |
| **Knowledge base** | pgvector search over per-use-case document sets |
| **Post-call steps** | Summary + compliance check (AI steps, not agents) |
| **Follow-up agent** | One agent serving every use case, with use-case-specific tools and rules |
| **Eval runner + release gate** | Runs any use case's scenarios; blocks publishing on failure |
| **Dashboard** | Use-case filter where relevant |

### Prompt framework (every agent)

**Persona** · **Objectives** · **Context** (no sensitive data before verification) · **Constraints** (compliance, figures only from tools) · **Fallback** · **Escalation** · **Few-shot examples** (EN + HI).

**Saim's role:** every prompt and every experiment choice is reviewed and decided by Saim. At each milestone Claude explains the key design decisions in plain English so Saim can defend them in an interview.

### Conversation behaviours (voice agents)

- **Interruptions:** customer can talk over the agent; agent stops and listens (Vapi barge-in).
- **Fallback:** not understood → rephrase; 2 consecutive failures → offer a human.
- **Silence:** prompt once, then close politely.
- **Language:** start in the customer's preferred language (EN or HI); follow switches, including Hinglish.
- **Disclosure:** every call opens by saying it is an AI assistant and the call is recorded.
- **Tone:** respectful, never threatening, never shaming, never over-promising.

## 5. Collections voice agent

### 5.1 Flow

```
Pre-call check (hours, attempts, do-not-call) ─► Greet + AI disclosure + recording notice
 ─► Confirm person ─► wrong person? → apologise, end, reveal nothing
 ─► Verify (DOB) ─► fail ×2 → end politely
 ─► State dues + read latest follow-up note (lookup_loan) ─► Listen for intent
 ─► Negotiate / answer / escalate ─► Recap agreement ─► Close
```

### 5.2 Intents

| Intent | Behaviour |
|---|---|
| `will_pay` | Capture date, amount, mode → `log_promise_to_pay` → offer `send_payment_link` |
| `cannot_pay` | Empathise, ask reason, offer later date or part payment within policy |
| `already_paid` | Capture date/mode/reference → mark for verification → no pressure |
| `dispute` | Note dispute → `transfer_to_human` |
| `wrong_person` | Apologise, reveal nothing, end |
| `wants_human` | `transfer_to_human` with summary |
| `policy_question` | `search_policy` → answer from docs or "I'll check with the team" |

### 5.3 Entities

| Entity | Examples | Rules |
|---|---|---|
| `promise_date` | "Friday", "agle Monday", "15 tarikh" | Resolved to ISO date; within policy window |
| `amount` | "full", "2000", "do hazaar", "half" | ≤ overdue; ≥ minimum part payment |
| `payment_mode` | UPI, net banking, debit card, branch | Allowed list |
| `delay_reason` | job loss, medical, salary late | Passed to follow-up agent for hardship judgement |

### 5.4 Context retention

- **Within the call:** verified state, captured entities, fallback count tracked server-side per call.
- **Across calls:** `lookup_loan` returns the **latest follow-up note** and last promise (kept / broken / pending). The agent uses it naturally: "Last time you mentioned paying on the 10th — we haven't received it yet. What happened?"

### 5.5 Tools

| Tool | Args | Returns | Guard |
|---|---|---|---|
| `verify_customer` | `dob` | verified, attempts left | Max 2 attempts |
| `lookup_loan` | — | overdue, EMI, due date, DPD, late fee, last-4 loan no., **latest note + last promise** | **Refuses unless verified** |
| `search_policy` | `query` | passages + source, or `not_found` | Similarity threshold |
| `log_promise_to_pay` | `amount`, `promise_date`, `payment_mode` | confirmation id | Verified; within policy |
| `send_payment_link` | `amount` | fake link `https://pay.suvidha.example/...` | Verified; ≤ overdue |
| `transfer_to_human` | `reason`, `summary` | handoff id + closing line | Always allowed |

The customer is identified from the call's metadata, never from what the LLM says.

## 6. After the call

```
Vapi end-of-call-report ─► save transcript + timings
 ─► Summary (AI step, Zod-validated)
 ─► Compliance check (code rules + AI step, with transcript evidence)
 ─► Follow-up agent (rules first, agent for judgement calls) ─► actions + note
```

### 6.1 Summary (AI step)

Outcome, intent, entities, sentiment, delay reason, handoff summary — Zod-validated JSON.

### 6.2 Compliance check (code + AI step)

- **Code rules:** verification happened before any loan tool returned data; AI disclosure present; every amount/date spoken matches a tool result; call within hours.
- **AI check:** threats, shaming, rude tone, disclosure to a third party, over-promising.
- Each failure cites the **exact transcript line**. Results stored per call.

### 6.3 Follow-up agent

**Rules (deterministic, run first)**

| Situation | Action |
|---|---|
| Wrong person | No retry on this number; flag for review |
| Customer asked not to be called / dispute | Do-not-call or human handoff |
| Promise logged | Schedule a promise check for the day after the promise date |
| Attempt limit reached | Stop retrying; human handoff |
| Compliance check failed | Human review; no automatic retry |

**Agent (judgement calls, only when rules don't decide)**
- Genuine hardship vs stalling (e.g. "my mother is in hospital", repeated excuses)
- Mixed or unclear signals (agreed then hesitated; partial promise)
- Best retry timing and guidance for the next call's tone
- Whether a human would handle this case better

**Tools:** `schedule_followup(date, reason)`, `create_handoff(reason, summary)`, `write_customer_note(note)`, `mark_do_not_call`, `set_hardship_flag`.
**Guards:** tools refuse dates outside calling hours, beyond attempt limits, or past policy windows — the agent cannot break the rules.

**Always:** every run writes a **customer note** — what happened, what was decided, why, and guidance for the next call. The voice agent reads it on the next call.

**Promise checks:** when a scheduled promise check comes due, the follow-up agent checks payment status → kept: close + note; broken: queue a new call with note "promise broken".

### 6.4 Demo controls

- **Demo clock** — set the simulated date/time (calling hours, promise due dates).
- **Payment toggle** per customer — "payment received" / "not received".
- **Run follow-ups now** — processes everything due at the demo clock time.

These make the whole loop demonstrable in a few minutes.

## 7. Pending — Lead qualification voice agent

**Built only after the core (M0–M6) works and passes its gates.**

- A person filled a "personal loan" interest form (fake `leads` table). The agent confirms interest, qualifies (loan amount, purpose, employment type, monthly income, city, existing EMIs), checks eligibility with **deterministic rules**, then books a sales callback or politely closes. Opt-out honoured immediately.
- **Tools:** `get_lead`, `check_eligibility`, `book_callback`, `send_application_link`, `mark_do_not_call`, `search_policy`, `transfer_to_human`.
- **Rules:** never promise approval, rate or amount beyond eligibility/product docs.
- Uses the same post-call steps and the same follow-up agent (lead rules: qualified → send to sales; call later → schedule; opt-out → do-not-call).
- ~8 eval scenarios; lead KPIs (contact, qualification, callback booked, opt-out rates).

## 8. Evals, experiments and release gate

### 8.1 Scenarios

| Target | Scenarios | Mix |
|---|---|---|
| Collections voice agent | ~20 | 5 personas (cooperative, angry, confused, elderly, wrong person) × 7 intents × EN/HI |
| Follow-up agent | ~6 | Given a call summary: genuine hardship, stalling, broken promise twice, mixed signals, compliance failure, clean promise |
| Lead qualification (pending) | ~8 | — |

### 8.2 How they run

Text simulation on free Gemini: **customer-simulator LLM** (persona card + hidden facts) ↔ **agent LLM** (same prompt framework, **same tool logic** on an in-memory fake DB) → **judge LLM** with a rubric (Zod-validated scores). Follow-up agent evals feed a prepared call record and judge the decision and note.

### 8.3 Metrics

- Task completion · intent accuracy · entity accuracy · correct handoff · quality (1–5)
- **Compliance** — zero tolerance
- **Hallucination** — every amount/date the agent says is checked against tool results
- **Consistency** — 5 key scenarios run **3 times**; behaviour must match
- Follow-up agent: decision correctness · note quality · rule adherence

### 8.4 Experiment log

`docs/reports/experiments.md` — per change: **Hypothesis** → **Change** → **Result** (before/after) → **Decision** (keep/revert). Saim chooses which experiments to run. At least one full v1 → v2 round.

### 8.5 Release gate

`npm run agent:publish <use-case>` pushes agent config to Vapi **only if** the latest eval run for that exact prompt version (content hash) shows compliance = 100%, hallucination failures = 0, task completion ≥ 80%. Otherwise it refuses and lists failing scenarios. Every publish is logged.

## 9. Compliance rules (code + tests at 100%)

| Rule | Enforced |
|---|---|
| Calls only 08:00–19:00 IST | Pre-call check; follow-up scheduling guard |
| Max attempts per customer per day/week | Pre-call check; follow-up guard |
| Do-not-call honoured | Pre-call check |
| AI disclosure + recording notice | Prompt + compliance check |
| Verify before disclose | Tools refuse until verified |
| No third-party disclosure | Wrong-person path + compliance check |
| No threats, abuse, shaming | Prompt + compliance check + evals |
| Figures only from tools | Prompt + compliance check + hallucination eval |
| Full audit trail | `calls`, `tool_events`, post-call results, follow-up actions, notes |

## 10. Data model (fake data, RLS on all tables)

| Table | Key fields |
|---|---|
| `customers` | name, dob, masked phone, preferred_language (en/hi), city, do_not_call, hardship |
| `loans` | customer_id, loan_number, product, emi, due_date, overdue_amount, dpd, late_fee |
| `payments` | loan_id, amount, paid_at, source (`demo_toggle`) |
| `calls` | use_case, subject_id, vapi_call_id, language, verified, attempt_no, transcript, started/ended |
| `tool_events` | call_id, tool, args, result, timestamp |
| `call_results` | call_id, summary (jsonb), compliance (jsonb) |
| `followup_runs` | call_id, path (rule/agent), decision, reasoning, actions (jsonb) |
| `followups` | customer_id, scheduled_for, reason, status |
| `customer_notes` | customer_id, call_id, note, created_by (followup-agent) |
| `promises` | call_id, loan_id, amount, promise_date, payment_mode, status |
| `handoffs` | call_id, reason, summary, status |
| `policy_chunks` | doc_set, doc, section, content, embedding |
| `eval_runs` / `eval_results` | target, prompt_hash, metrics; scenario, run_no, scores, transcript, pass |
| `publishes` | use_case, prompt_hash, eval_run_id, published_at |
| `demo_settings` | demo_clock |

Seed: ~8 borrowers (EN/HI), some with previous calls, notes, and broken promises.

## 11. Knowledge base

`knowledge/collections/`: FAQ, fees and charges, collection and repayment policy, RBI fair-practice summary (own words). Chunked by section → Gemini embeddings → `policy_chunks`. Below threshold → "I'll check with the team."

## 12. Dashboard

**Look:** polished, **very light blue background across all screens**, one light theme. Detailed design (layout, call pop-up) agreed with Saim during the build.

| Page | Shows |
|---|---|
| **Overview (KPIs)** | Right-party contact rate, verification rate, promise-to-pay rate, promises kept/broken, escalation rate, hardship cases, compliance pass rate |
| **Customers** | List; detail with loan, notes timeline, follow-ups, **payment toggle** |
| **Call simulator** | Pick customer → pre-call check → call **pop-up** with live transcript |
| **Calls** | List with outcome, language, flags |
| **Call detail** | Transcript, tool timeline, summary, compliance evidence, **follow-up decision (rule or agent, and why)** |
| **Follow-ups** | Scheduled items; **Run follow-ups now**; demo clock |
| **Human queue** | Handoffs with summaries |
| **Evals** | Runs per prompt version, metrics, consistency, v1 vs v2, release-gate status |

## 13. Non-functional

- Voice response latency target < 1.5 s typical (measured in M1).
- Coverage: 80% overall; 100% on money, identity, compliance, follow-up rules and guards, webhook auth, validation, release gate.
- Secrets in env only; webhook secret verified; RLS everywhere; no personal data in logs.

## 14. Setup — Saim does these (Claude can't create accounts)

| # | Task | When |
|---|---|---|
| 1 | **Supabase** project (free): project URL, anon key, service-role key | Before M0 |
| 2 | **Vapi** account, no card: public key + private key | Before M1 |
| 3 | **Gemini API key** from Google AI Studio (free) | Before M1 |
| 4 | **Vercel** account (free) | Before M7 |

Keys go into `.env` and Supabase function secrets — never into chat or code.

## 15. Milestones

Lean pipeline per `guidelines/workflow.md`: plan stop → build + tests → quality gate + smoke test → results stop. Full review + scoring at **CP1**, **CP2**, **CP3**. Estimates are optimistic; voice debugging may stretch them — the cut order protects the core.

| # | Milestone | Est. | Day |
|---|---|---|---|
| M0 | Foundation | 45 m | Sat |
| M1 | Voice spike (EN + HI) | 45 m | Sat |
| M2 | Platform core + collections tools + compliance → **CP1** | 1 h 30 | Sat |
| M3 | Collections conversation + memory + RAG | 1 h 30 | Sat |
| M4 | Post-call steps + follow-up agent + demo controls | 1 h 15 | Sat |
| M5 | Dashboard → **CP2** | 1 h 15 | Sat/Sun |
| M6 | Evals + consistency + experiment log + release gate | 1 h 30 | Sun |
| P1 | *(Pending)* Lead qualification agent | 1 h | Sun |
| M7 | Go-live pack → **CP3** | 45 m | Sun |

### M0 — Foundation
- Scaffold (`web/`, `supabase/`, `agent/`, `knowledge/`, `evals/`), lint/format/test tooling, `.env.example`
- `docs/architecture.md` + ADRs: Vapi, single webhook + tool registry, Supabase, Gemini, verify-in-code, one live agent + follow-up agent handover, rules-before-agent
- Migrations + RLS + seed data
- `docs/delivery/requirements.md`, `user-stories.md`
- **Done when:** lint/typecheck/test green on the scaffold; DB seeded

### M1 — Voice spike (EN + HI)
- Vapi assistant from config as code; browser call from a bare page
- Test EN and HI/Hinglish: transcription, voice, interruptions, latency; confirm Gemini usable as agent model with own key
- **Done when:** 1-minute call works in EN and HI; findings in an ADR

### M2 — Platform core + collections tools + compliance
- `vapi-webhook`: secret check, tool registry, Zod validation, `tool_events` audit
- Collections tools (§5.5); compliance engine + `/v1/calls/authorize` (TDD, 100%)
- **Done when:** a voice call verifies, states seeded dues, logs a promise; loan details provably refused before verification
- **CP1**

### M3 — Collections conversation + memory + RAG
- Prompt framework + few-shots (EN/HI) — reviewed by Saim
- Intents, entities, fallback, handoff; latest note + last promise in `lookup_loan`
- Knowledge docs → embeddings → `search_policy`
- **Done when:** every intent works in a manual voice test; a returning borrower with a broken promise is handled using the note; unknown policy question → "I'll check with the team"

### M4 — Post-call steps + follow-up agent + demo controls
- End-of-call webhook → summary → compliance check → follow-up (rules, then agent)
- Follow-up tools with guards; notes always written; promise checks
- Demo clock, payment toggle, "run follow-ups now" endpoint
- **Done when:** a call produces summary, compliance result and a follow-up decision with a note; a broken promise (toggle off + clock forward) queues a new call whose agent mentions the broken promise

### M5 — Dashboard
- Light-blue theme agreed with Saim; all pages in §12, including call pop-up and follow-up decision view
- **Done when:** the full demo loop runs from the dashboard alone
- **CP2**

### M6 — Evals + consistency + experiment log + release gate
- Scenarios (collections + follow-up), simulator, judge, runner; hallucination and consistency checks; Evals page
- v1 run → failure analysis → Saim picks experiments → v2 run → `experiments.md`
- `agent:publish` with release gate
- **Done when:** v1/v2 visible with before/after; publishing a deliberately broken prompt is refused

### P1 — Lead qualification (pending)
- Go/no-go decided by Saim after M6. Scope in §7.
- **Done when:** a voice call qualifies a lead and books a callback; opt-out blocks the next call; evals pass the gate

### M7 — Go-live pack
- Deploy web to Vercel; final function and agent publishes
- `docs/delivery/solution-design.md`, `uat-checklist.md` (executed), `go-live-checklist.md`, `telephony.md` (moving to real phone lines: SIP/number forwarding, consent, DLT, recording, voicemail detection), `alternatives.md` (LangGraph, Retell, Vapi Squads, adding languages)
- README with demo script; Saim records a 3–5 minute demo video (backup for live demos)
- **CP3:** refactor → review → score
- **Done when:** live URL works end-to-end; CP1–CP3 Green

### If time runs out — cut in this order
1. P1 Lead qualification
2. E2E tests
3. Second experiment round (keep v1 + failure analysis)
4. Consistency runs (keep single runs)
5. Customers page detail (keep payment toggle on Follow-ups page)

**Never cut:** compliance enforcement, verify-before-disclose, follow-up notes, release gate, quality gate, recorded demo.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Hindi transcription/voice quality | Tested first in M1; tune transcriber/voice choice |
| Vapi free credit smaller than expected (~$5) | Voice only for manual tests + demo; bulk testing as text evals |
| Gemini free-tier rate limits during evals | Throttle; cheaper model for simulator; cap turns |
| Gemini not usable as Vapi's agent model with own key | Vapi's cheapest built-in model within credit; recorded in ADR |
| Voice debugging slower than estimated | Cut order; core protected |
| Live demo failure in interview | Recorded video backup |
| Interviewer probes design understanding | Saim reviews prompts and experiments; plain-English decision notes each milestone |

## 17. Job-description coverage

| JD item | Where |
|---|---|
| Prompts, prompt frameworks, few-shot | §4, M3 |
| Business requirements → flows, decision logic, guardrails | §5, §6.3, §9 |
| Agents using tools / calling APIs, multi-step conversations | §5.5, §6.3 |
| Intents, entities, context retention, interruptions, fallback, handoff | §4, §5.2–5.4 |
| Structured outputs, hallucination control | §6.1, §8.3 |
| Testing across scenarios, personas, languages, paths | §8 |
| Failure analysis, inconsistency, continuous improvement | §8.3–8.4 |
| Evaluation frameworks and test datasets | §8 |
| ASR, TTS, telephony | M1, `telephony.md` |
| Multiple languages | English + Hindi (Hinglish) |
| Collections; lead qualification | §5; §7 (pending) |
| RAG, vector DB, knowledge base | §11 |
| Multi-agent workflows | Voice agent → follow-up agent handover (§6.3) |
| APIs, JSON, webhooks, integrations | §4, §6 |
| BFSI compliance | §9 |
| Performance data, transcript review | §12 |
| Agent platforms (Vapi / Retell / LangGraph) | Vapi + `alternatives.md` |
| Discovery → POC → UAT → go-live; user stories; implementation docs | `docs/delivery/`, M0, M7 |
| Execution with speed and quality | Lean workflow, quality gates, checkpoints, scoreboard |
