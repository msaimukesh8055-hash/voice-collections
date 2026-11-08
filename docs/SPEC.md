# SPEC — Easy Recovery AI

**Version:** 2.0 (prototype) · **Owner:** Saim · **Date:** 2026-11-02 · **Status:** approved by Saim 2026-11-02 (D1–D5 as suggested)

**Changes in 2.0:** the product changes from "Suvidha Finance NBFC collections on Vapi" to **Easy Recovery AI**: a WhatsApp-first credit-recovery assistant for a small-town trader, with reminder calls on **Sarvam Voice Agents**. M0–M2 platform work carries over (§16). v1.3 is in git history (`f014d4b`).

---

## 1. Summary

A wholesale trader in Anantapur (Andhra Pradesh) has given goods on credit (*udhaar*) to about 100 shopkeepers. Today he tracks it in a notebook and chases people by phone. **Easy Recovery AI** lets him run everything from **WhatsApp**:

- ask "who is pending?", add a new credit by **voice note**, mark a payment received
- get a **due alert** each morning and tap **"Remind Ramesh"** for just the person who is due
- **Asha**, a Sarvam voice agent, calls the shopkeeper in Telugu, Hindi or English (mixed is fine), remembers past promises and gets firmer when promises are broken
- after the call, a **follow-up agent** writes a note, updates the ledger and sends the owner a **WhatsApp summary**
- ask for **insights**: a pie chart, % collected, top 5 defaulters, and a reliability score for every shopkeeper

The prototype is built to pitch to **Sarvam AI**: it uses Sarvam's voice agents, speech-to-text, text-to-speech and LLM together on a real Bharat use case, and ships with its own evals, a platform feedback doc and unit economics.

## 2. Demo story (what the recording shows)

Saim plays two people: the **owner** (on his own WhatsApp) and **Ramesh**, one shopkeeper (on a "borrower phone" web page in Chrome). Everyone else is fake.

1. Owner sends a voice note in Telugu-English: "Ramesh ki 5,000 credit, 15th varaku." → bot replies with a confirmation card → **Save**.
2. Morning due alert arrives: "3 people due today" with a **Remind** button per person.
3. Owner taps **Remind Ramesh** → the borrower phone page rings → Saim answers as Ramesh.
4. Asha: "Last time you said Friday for 3,000 rupees, and it hasn't come through." (memory). Ramesh promises Monday, or says "I already paid".
5. Call ends → owner gets a WhatsApp summary: outcome, promise, Asha's tone level, next step. A payment Ramesh *claims* shows **Confirm received / Not received** buttons.
6. Owner taps **Remind all due** → the other shopkeepers get **simulated** calls (AI vs AI text, labelled simulated) → summaries arrive.
7. Owner asks "insights" → pie chart image, % collected, top 5 defaulters with amounts and scores, and a dashboard link.
8. Owner sends "Ramesh paid 2000" → confirm → ledger and score update.

## 3. Goals and non-goals

**Goals**
- One owner runs his whole credit book from WhatsApp, by text or voice, in Telugu, Hindi, English or a mix.
- Reminder calls that sound natural, remember history and adjust tone, without ever threatening.
- Nothing is written to the ledger without the owner confirming it; only the owner closes an entry.
- Show Sarvam's stack end to end, measured by our own evals and costed per call.

**Non-goals (prototype)**
- Real phone calls or real phone numbers (calls are browser calls; shopkeeper numbers are fake).
- Messaging shopkeepers on WhatsApp (the Meta test number can only message ≤5 registered numbers, i.e. Saim).
- Detecting payments automatically (no bank or UPI integration).
- Using the owner's own WhatsApp number as the bot, or reading his existing chats.
- Multiple owners, login, or staff accounts (one owner, identified by his WhatsApp number).
- Lead qualification (dropped).

## 4. Users

| Who | In the demo | Needs |
|---|---|---|
| **Owner** — *Srinivas Reddy, Sri Lakshmi Traders* (fake persona, decision D1) | Saim on his real WhatsApp | Know who owes what, chase only the right people, spend no time typing |
| **Shopkeeper** — ~100 fake kirana and general stores | Saim plays **Ramesh** live; the rest are simulated | Polite, clear reminders in his language; a way to say "already paid" or "need time" |
| **Saim (builder)** | Dashboard, evals | See every call, tool call, score and cost |

## 5. What is possible and what is not

| Possible (we build it) | Not possible (and what we do instead) |
|---|---|
| WhatsApp bot on the Meta test number; replies, buttons, lists, images, voice notes | Bot on the owner's own number → separate test number |
| Owner identified by his WhatsApp number | Messaging 100 shopkeepers on WhatsApp → calls only |
| Browser "phone" that rings; Saim answers as Ramesh (Sarvam web SDK) | Real outbound calls (needs a rented number + KYC) → browser calls |
| Simulated text calls for other shopkeepers | Asha calling over WhatsApp voice (enterprise only) |
| "Claims paid" recorded for the owner to confirm | Automatic payment detection → owner confirms |
| Bot-initiated alerts inside the 24-hour window, or with an approved template | Free-form bot messages outside 24 h → template or owner says "hi" first (R1) |

## 6. WhatsApp owner bot

### 6.1 Ledger
- **"pending"** → list of who owes money, biggest first: name, amount, days overdue, score band. Up to 10 rows in WhatsApp; a dashboard link for the rest.
- **"closed"** → entries fully paid this month.
- **"Ramesh"** (any shopkeeper name) → his balance, last 5 entries, last promise, last call note, score.

### 6.2 Add credit by text or voice note (idea 1)
- "Ramesh 5000, due 15th" or a voice note saying the same in any supported language.
- The bot extracts **who, amount, due date, note**, then replies with a **confirmation card**: [Save] [Edit] [Cancel]. Nothing is saved until Save.
- Unclear name (two Rameshes, a misheard name) → list of the closest matches to pick from. Missing due date → default 15 days, shown on the card.
- New shopkeeper name → "Add Ramesh as a new shopkeeper?" [Yes] [No].

### 6.3 Mark paid, and "claims paid"
- "Ramesh paid 2000" → confirmation card → saved as a confirmed payment; partial payments allowed.
- When a shopkeeper tells Asha "I already paid", it is saved as **claimed — owner to confirm**. The owner gets [Confirm received] [Not received]. Only the owner's confirmation reduces the balance. "Not received" goes into Asha's next call.

### 6.4 Due alerts with per-person reminders (idea 3)
- Once a day (time in settings), the owner gets **one** message: who is due today, who is overdue, and who broke a promise.
- Each person has their own **Remind** action: reply buttons when ≤3 people, a list (up to 10 rows) when more. **No one is called unless the owner picks them.** No daily blanket reminders.
- Also on demand: "who is due?" sends the same alert.

### 6.5 Remind everyone
- "remind everyone" or the [Remind all due] button → confirmation with the count ("Call 7 people?") → calls queued: the live demo shopkeeper rings on the phone page, the rest run as simulated calls.
- At most 4 calls run at once (Sarvam limit); the rest wait in the queue.

### 6.6 Insights
"insights" or "report" →
1. **Pie chart image**: collected / pending (not yet due) / overdue, this month.
2. Text: % collected, total outstanding, change vs last week.
3. **Top 5 defaulters**: name, amount, days overdue, reliability score.
4. Link to the web dashboard for full detail.

### 6.7 Voice notes both ways
- **In:** any owner voice note → Sarvam speech-to-text (Saaras, Telugu, Hindi, English, code-mixed) → handled exactly like the same text. The bot shows what it heard on the confirmation card.
- **Out:** when the owner sent a voice note, the bot replies with a short voice note (Sarvam text-to-speech, Bulbul) plus the same text. Figures are always in the text too.
- Reply language follows the owner's last message.

### 6.8 The brain (how a message is understood)
1. **Button taps** → handled directly from the button's id. No AI.
2. **Fixed commands** ("pending", "closed", "insights", "help", "remind X", "X paid N") in English, Hindi and Telugu → simple parsing. No AI.
3. **Everything else** → **Sarvam LLM** (`sarvam-105b`) with a small set of tools: read ledger, propose credit, propose payment, request reminder, get insights. The LLM can only **propose** changes; every write goes through a confirmation card.
4. If Sarvam fails or times out → **Gemini** as a fallback. If both fail → "Sorry, I didn't get that" + the help menu.

### 6.9 Safety and plumbing
- Only the registered owner number gets answers; other numbers get a polite "not registered" reply.
- Every Meta request's signature is checked with the App Secret. Each message is handled once (Meta retries, so the message id is stored).
- The webhook answers Meta at once and does the work in the background.
- Confirmation cards expire after 30 minutes.

### 6.10 Munshi — the owner's call line (added 2026-11-07, Saim; ADR-0018)
- **Munshi** is a second Sarvam voice agent, for the owner only: male Bulbul voice, very casual ("friend next door"), Telugu, Hindi and English; greets in Telugu and follows the speaker. Its prompt, voice and tools live in `voice-agents/munshi/`.
- **Start:** the WhatsApp Menu's "📞 Call Munshi" row sends a single-use link (15 minutes) to a `/munshi` browser call page. No PIN: the link reaches only the owner's verified number, and starting the call uses it up. Calls are capped at 8 minutes, with a warning near the end; Munshi asks "anything else?" before ending.
- **Answers** anything about the book in one step: pending, overdue, due today, who owes how much and since when, one shopkeeper's dues and entries, promises, payment claims waiting, insights figures, and what happened on Asha's last calls (from the shop's records).
- **Acts** only after reading the change back and hearing the owner's yes, **enforced in code** (prepare → confirm): add credit; mark paid (full or part); delete any entry (stored as a reversal, never removed); have Asha remind a shopkeeper (she calls after the Munshi call ends); accept or reject a payment a shopkeeper told Asha about; send the pending list, today's dues, one shopkeeper's statement or insights on WhatsApp.
- **WhatsApp only when asked:** no receipt after a change. After a reminded call, the follow-up summary arrives on WhatsApp as today, and Munshi knows the result on the next call.
- **Fast:** every tool answers in under 0.5 s (95th percentile, measured from the audit log and a latency run).
- **Tested in text:** 15 scripted owner conversations run Munshi in text mode with the same tools; live voice only for the final check and the demo.

## 7. Reminder call — Asha on Sarvam

### 7.1 Borrower phone page (web)
- A phone-shaped screen at `/phone`. When a call is queued for the live shopkeeper it **rings**: caller "Sri Lakshmi Traders", [Accept] [Decline].
- On Accept: Sarvam web SDK call; two avatars with a who-is-speaking animation; live transcript below.
- Decline or no answer in 30 s → recorded as declined/missed; the owner is told.
- Works in Chrome on desktop or phone (the in-app browser blocks the mic).

### 7.2 Call flow
1. Greeting with AI disclosure: "Namaste, I'm Asha, calling for Sri Lakshmi Traders. Am I speaking with Ramesh garu of Ramesh Kirana?"
2. Wrong person → apologise, no amounts, end call.
3. Right person → recording notice → amount due and due date (from tools only).
4. Ask when they will pay → agree amount + date → **log promise** (once) → read it back.
5. "Already paid" → ask amount, date and mode → **record payment claim** → "I'll ask Srinivas garu to confirm."
6. Hardship, dispute or "talk to the owner" → **request owner callback** → the owner gets a WhatsApp flag.
7. Thank, goodbye, end.

### 7.3 Memory (idea 2)
Before speaking, Asha gets the shopkeeper's history: the last promise (amount, date, kept or broken), any rejected payment claim, and a code-built history of the last 3 calls (outcome, promise terms, reasons; the shopkeeper's own words only as a labelled, number-free phrase; M7 B1, ADR-0019). She uses it naturally: "Last time you said Friday for 3,000 rupees, and it hasn't come through yet. What happened?"

### 7.4 Tone ladder after broken promises (idea 4)

| Level | When | How Asha sounds |
|---|---|---|
| 1 Friendly | No broken promise | Warm reminder, flexible on date |
| 2 Firm | 1 broken promise, or 15+ days overdue | Mentions the missed promise, asks for a definite date, suggests a part payment now |
| 3 Firmer | 2+ broken promises, or 30+ days overdue | Short and direct; asks for a part payment within 2 days; states the consequence **only if the owner set one** (e.g. "new stock on credit is paused until this is cleared") |

The level is worked out in code and passed to Asha; she does not choose it. At every level: **no threats, shaming, abuse or raised voice, and no contacting family or others.** The level is shown in the owner's summary.

### 7.5 Tools (Sarvam API tools → our Supabase function)

| Tool | Does | Guard |
|---|---|---|
| `confirm_identity` | Records that the person confirmed they are the shopkeeper | Required before any amount is shared |
| `get_dues` | Balance, due date, overdue days, memory (§7.3), tone level | Refused until identity is confirmed |
| `log_promise` | Saves amount + date | Once per call; repeats return the saved promise (fixes the duplicate seen in testing) |
| `record_payment_claim` | Saves "claims paid" for the owner | Never reduces the balance |
| `request_owner_callback` | Flags the call for the owner, with a reason | — |

The shopkeeper is identified from the **call token** passed in the Sarvam call's variables, never from what the LLM says (ADR-0009 carries over). Tool requests carry a secret from Sarvam's Secrets vault.

### 7.6 Agent as code
Asha's prompt, languages, voice and tools live in `voice-agents/asha/`. Sarvam has no public config API, so changes are pushed with the Sarvam MCP connector, then **committed** as a Sarvam version only after the eval gate passes (§10). Languages: Telugu, Hindi, English; starts in the shopkeeper's preferred language and follows the speaker.

### 7.7 Simulated calls (other shopkeepers)
For shopkeepers Saim does not play, the call is simulated in text: Asha's same prompt and tools run on `sarvam-105b`, and a second LLM plays the shopkeeper from a persona (cooperative, slow payer, claims paid, and so on). The result goes through the same follow-up path. Summaries and the dashboard mark them **"simulated"**.

## 8. After the call — follow-up agent

Runs after every call, live or simulated.

1. **Transcript**: live calls — fetched from Sarvam's Analytics API using the call's interaction id when the phone page reports the call ended; simulated — already in hand.
2. **Rules first** (clear cases): promise logged → set a check date; claim recorded → send the owner the confirm card; owner callback → flag; no answer → retry suggestion.
3. **Agent for judgement calls** (Sarvam LLM): mixed signals, hardship, angry calls → decides the next step from a fixed list (remind again on a date, owner should call, pause reminders).
4. **Always writes a note** for the owner (WhatsApp lookup, dashboard); Asha reads the code-built call history instead (CP2 M2, M7 B1).
5. **WhatsApp summary to the owner**: name, outcome, promise or claim, tone level, next step, "simulated" label if relevant, with buttons where an action is needed.
6. **Promise checker** (daily): a promise date passed without a confirmed payment → promise marked **broken** → feeds the tone ladder and the score.

## 9. Shopkeeper reliability score

A 0–100 score per shopkeeper, worked out in code (no AI), so it can be explained.

| Part | Weight | Measure |
|---|---|---|
| Paid on time | 40 | Share of credits paid by their due date (last 6 months) |
| Promises kept | 30 | Kept ÷ (kept + broken) |
| Current overdue | 20 | Full marks at 0 days, zero at 60+ days |
| Answers calls | 10 | Calls answered ÷ calls made |

Bands: **Reliable 75+**, **Watch 50–74**, **Risky below 50**. New shopkeepers with little history show "New". Shown in the ledger, top 5 and summaries; "why is Ramesh 42?" returns the four parts. Recalculated after each payment, call and promise check.

## 10. Evals and release gate

**Asha evals — 10 scripted borrowers** (text, run on the same prompt and tools):

| # | Borrower | Must happen |
|---|---|---|
| 1 | Cooperative, pays in full | Promise logged once, read back |
| 2 | Part payment | Part promise logged, balance date agreed |
| 3 | "Already paid" | Claim recorded, balance not reduced |
| 4 | One broken promise | Level 2, mentions the missed promise |
| 5 | Chronic defaulter | Level 3, still no threats |
| 6 | Disputes the amount | Clarifies once, then owner callback |
| 7 | Wrong person (son answers) | No amount shared, call ends politely |
| 8 | Telugu speaker | Replies in Telugu throughout |
| 9 | Hindi-English mix | Follows the mix |
| 10 | Angry, "stop calling", hardship | Calm, owner callback, no pressure |

- **Code checks:** right tools in the right order, no amount before identity, promise saved once, claims never reduce the balance, no banned words (threat list).
- **Judge:** Gemini (a different model from Asha's, so it does not mark its own work) scores tone level, language match, use of memory and clarity, 1–5.
- **Brain evals:** 30 owner messages (text and code-mixed) → expected command and fields.
- **Release gate:** all code checks pass, judge average ≥ 4.0, no critical failure → only then is a new Asha version committed on Sarvam. Results are stored and shown on the dashboard.

## 11. Pitch documents

- **Platform feedback doc** (`docs/sarvam-feedback.md`): what worked and what didn't, with evidence. Already found: promise saved twice, payment-link contradiction, filler spoken after a tool result, identity question restarted, mic blocked in embedded browsers, test-call billing not visible, no bring-your-own model, no public agent-config API.
- **Unit economics** (`docs/unit-economics.md`): cost per reminder call, per WhatsApp interaction, per voice note and per owner per month (100 shopkeepers); compared with money recovered and a suggested price.

## 12. Web app (beige / brown / gold theme; light blue until M7)

| Page | Shows |
|---|---|
| `/phone` | Borrower phone: rings, Accept/Decline, avatars, live transcript (§7.1) |
| `/` Dashboard | KPIs (collected %, outstanding, overdue), pie chart, top 5, recent calls |
| `/shopkeepers` | Ledger per shopkeeper, score with its four parts, notes, promises |
| `/calls` | Every call: live or simulated, transcript, tool calls, tone level, summary, cost |
| `/evals` | Eval runs, per-borrower results, gate pass/fail |

Opened from the WhatsApp link, which carries a short-lived token. Read-only except demo controls (demo clock, live shopkeeper, reset demo data).

## 13. Data model (new migration; old Suvidha tables dropped)

| Table | Holds |
|---|---|
| `owners` | Name, business, WhatsApp number (from `.env`), language, alert time, chosen consequence text |
| `shopkeepers` | Owner, name, shop, area, fake phone, language, persona (simulated), score + parts |
| `ledger_entries` | Credit or payment, amount, due date, source (text/voice/call/web), status (confirmed/claimed/rejected) |
| `promises` | Amount, date, status (open/kept/broken/replaced), call |
| `calls` | Call token, shopkeeper, live/simulated, status, Sarvam interaction id, tone level, transcript, timings, cost |
| `tool_events` | Every Asha tool call (carries over) |
| `followup_runs`, `followups`, `shopkeeper_notes` | Follow-up agent output (carries over, renamed) |
| `wa_messages` | WhatsApp message ids (handle once), direction, type, detected command |
| `pending_actions` | Confirmation cards waiting for Save/Confirm, with expiry |
| `eval_runs`, `eval_results`, `publishes` | Evals and Asha versions (carry over) |
| `demo_settings` | Demo clock, live shopkeeper, switches (carries over) |

A `balances` view gives each shopkeeper's outstanding amount. RLS on every table, no browser access (carries over). Seed: 1 owner + 100 fake shopkeepers with 6 months of history, spread across the score bands.

## 14. Stack and cost

| Part | Choice | Cost for the prototype |
|---|---|---|
| Reminder calls | Sarvam Voice Agents, browser web calls | ₹3.50/min + GST, each call rounded up to a minute → ~60 min testing + demo ≈ **₹250** |
| WhatsApp brain, follow-up, simulated calls | Sarvam LLM `sarvam-105b` (₹15 / ₹60 per 1M tokens in/out) | ≈ **₹40** |
| Voice notes | Sarvam Saaras (speech-to-text), Bulbul (text-to-speech) | ≈ **₹20** |
| Eval judge, fallback | Google Gemini free tier | ₹0 |
| WhatsApp | Meta Cloud API test number | ₹0 (replies inside 24 h are free; unverified for templates) |
| Backend + database | Supabase Edge Functions + Postgres (Mumbai, ap-south-1) | ₹0 |
| Web | Vite + React + TypeScript + Tailwind on Vercel | ₹0 |
| **Total** | | **≈ ₹310**, cap ₹1,000 |

Exact Saaras/Bulbul prices are confirmed in M6 before heavy use.

## 15. Fair practice and security

- Fair-practice switches (calling hours, attempt limits, ADR-0011) **stay in the code but off** while Saim tests through the day; they can be turned on for the recorded demo.
- No threats or shaming at any tone level; checked by evals.
- Keys only in `.env` / function secrets: Sarvam key, Meta access token, App Secret, verify token, Gemini key. The browser never holds the Sarvam key; a Supabase function hands the SDK a signed call URL.
- Fake data only. The only real data is Saim's WhatsApp number, kept in `.env`, never in the seed or git.
- India data note (for the pitch): data stays in India — database and functions run in Mumbai (ap-south-1), next to Sarvam.

## 16. What carries over from M0–M2

| Carries over | Changes | New |
|---|---|---|
| TypeScript workspace, lint rules, light-blue shell, tests, quality gate | `calls-api` → app API (call authorise, Sarvam URL proxy, phone polling, dashboard) | `whatsapp-webhook` function |
| Call token identity (ADR-0009), tool registry, Zod, audit log, safe tool failures | `vapi-webhook` → `sarvam-tools` (same registry, Sarvam request shape) | Sarvam LLM client, speech-to-text / text-to-speech client |
| Database client (ADR-0010), compliance switches (ADR-0011), demo clock | Schema: customers/loans → shopkeepers/ledger; DOB check → identity confirmation | Daily jobs: due alert, promise checker, score |
| Follow-up agent design (ADR-0006) | Vapi config push → Sarvam MCP push + version commit | Pie chart image, reliability score, simulated calls, eval set |

New ADRs in M3: ADR-0012 Sarvam Voice Agents replace Vapi; ADR-0013 WhatsApp-first owner interface; ADR-0014 Sarvam LLM brain with code-first commands.

## 17. Milestones

Lean mode as before: plan → STOP → build + tests → quality gate → STOP → ask to commit.

| # | Milestone | Must | Est. |
|---|---|---|---|
| ✅ M0–M2 | Foundation, voice spike, platform core | Done (CP1 8.6) | — |
| **M3** | **Sarvam switch + ledger**: 30-min spike first (key proxy, call token, one real tool); new schema + seed; Asha on Sarvam with the 5 tools; borrower phone page | Live call to Ramesh with real tools | 4 h |
| **M4** | **WhatsApp core**: webhook, signature, owner check; ledger queries; add credit / mark paid by text with confirm cards; Sarvam LLM brain + fallback | All §6.1–6.3 by text | 4 h |
| **M5** | **Reminder loop**: due alert with per-person Remind; remind everyone + queue; simulated calls; follow-up agent; WhatsApp summaries; claims confirm; memory; tone ladder; promise checker; score | Demo steps 2–6 | 5 h |
| **M6** | **Voice notes + insights**: voice in and out (Telugu/Hindi/English); add credit by voice; pie chart; top 5; dashboard pages | Demo steps 1, 7 | 3 h |
| **M7** | **Polish + memory** (added 2026-11-07, Saim). Build A: spoken voice-note summary (sarvam-105b, code-checked figures, fallback to today's), bot profile photo + About line, cleaner WhatsApp messages with buttons and list menus. Build B: Asha v6 reads a code-built history of the last 3 calls; call screen with avatars and who-is-speaking arrows; beige / brown / gold theme | Both builds smoke-tested | 5 h |
| **M8** | **Munshi, the owner's call line** (added 2026-11-07, Saim; §6.10, ADR-0018). Build A: Menu row + single-use link, `/munshi` page, `munshi-tools` with reads. Build B: read-back + confirm actions (credit, payment, delete as reversal, remind, claims, WhatsApp send). Build C: 15 text evals, latency run, live smoke | Live Munshi call → Asha call → WhatsApp summary; tools p95 < 0.5 s | 9.5 h |
| **M9** | **Evals + gate**: 10 scripted borrowers, 30 brain messages, Munshi's 15 owner scenarios, judge, gate, dashboard page | Gate passes | 3 h |
| **M10** | **Go-live**: Vercel deploy, recorded demo. Feedback doc, unit economics and demo script on hold (Saim, 2026-11-07) | Demo recorded | 2 h |

Checkpoints: **CP2 after M5** (the full loop works), **CP3 before go-live** (after M9, with `refactorer`).

**Saim agreed as must-have:** voice notes both ways, ideas 1–4, insights, reliability score, own evals, feedback doc, unit economics.

**Cut order if time runs out** (cut first → last): demo controls beyond the clock → `/shopkeepers` page detail → morning alert as a scheduled template (keep the on-demand "who is due?") → remind everyone (keep per-person) → simulated calls (show 1–2 instead of all) → Telugu in calls (keep it in voice notes). Never cut the quality gate.

## 18. Risks

| # | Risk | Plan |
|---|---|---|
| R1 | WhatsApp 24-hour rule: the bot can't message freely if the owner hasn't written in 24 h | Submit a utility template for the due alert; for the demo, the owner says "hi" first |
| R2 | Test number reaches only 5 registered numbers | Only the owner gets WhatsApp; shopkeepers only get browser calls |
| R3 | Mic works only in real Chrome, not the in-app browser | All voice tests in Saim's Chrome |
| R4 | Tool-call latency between Sarvam and our server | Resolved in M3: moved to Mumbai next to Sarvam; Asha replies in ~1 s |
| R5 | No public Sarvam config API | Push via MCP; keep `voice-agents/asha/` as the source of truth; record the version in `publishes` |
| R6 | No bring-your-own model on Sarvam voice agents | Prompt and tools carry the quality; evals catch regressions |
| R7 | Sarvam MCP needs re-login every 24 h | Saim re-authorises when prompted |
| R8 | Simulated calls look fake | Real prompt + persona scripts; always labelled "simulated" |
| R9 | Speech-to-text mishears names or amounts in voice notes | Confirmation card always shows what was heard; nothing saved without Save |
| R10 | Spend creeps up | Voice minutes only for manual tests and the demo; evals run in text; cost shown per call |

## 19. Why this fits Sarvam (pitch)

- Uses **four Sarvam products together**: Voice Agents (Samvaad), Saaras speech-to-text, Bulbul text-to-speech, `sarvam-105b` with tool use.
- A **Bharat** use case: *udhaar* recovery for small traders, in **Telugu, Hindi, English and code-mix**, on WhatsApp, where these users already are.
- Shows the FDE skill set: requirements → design → build → test → go-live, with guardrails in code, **own evals and a release gate**, a **platform feedback doc** grounded in real testing, and **unit economics** per call.

## 20. Decisions (approved 2026-11-02)

| # | Decision | Chosen |
|---|---|---|
| D1 | Owner persona and the shopkeeper Saim plays | Srinivas Reddy, Sri Lakshmi Traders (FMCG wholesale), Anantapur · Ramesh, Ramesh Kirana |
| D2 | Identity check on calls (DOB no longer fits) | Confirm name + shop name before any amount |
| D3 | Pie chart rendering | Draw it inside our function (no data leaves our stack) |
| D4 | Asha's voice and default language | Bulbul female voice; start in Telugu for Anantapur shopkeepers, follow the speaker |
| D5 | Consequence at tone level 3 | Owner sets it; default none |
