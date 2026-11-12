# Build Log

The story of the build, newest first: three lines per step. Full detail (plans, decisions, test results, bugs and fixes) lives in [`docs/milestones/`](milestones/) and [`docs/adr/`](adr/).

---

**2026-11-12 · M9 Builds B + E — Pause switch, documents · ✅ Shipped (merged to main, pushed)**
`/pause` and `/resume` stop and restart every new reminder call (verified live: a paused call is refused and no call row is created); unit economics, three incident write-ups, runbook, walkthrough and threat model written; README gets a CI badge and a production-readiness section.
Deno 1,484 + root 272 + web 254 · not done: CP3 review, SPEC update, rollback rehearsal, registering the two commands in WhatsApp's menu (wording is a draft) · Details → [`milestones/M9.md`](milestones/M9.md)

**2026-11-12 · M9 Builds C + D — Evals, Evals page, CI · ✅ Shipped (merged to main, pushed)**
Asha runs 9 cases on Sarvam Tests with our own database checks, the WhatsApp brain runs 21 messages in code, both behind a release gate and shown on `/evals`; GitHub Actions runs the full gate on every push (first run green). Asha's gate failed at 16/18 behaviours (3 prompt findings for Saim, no money or identity failure); the brain passes 21/21 after two parser fixes.
Deno 1,478 + root 272 + web 253 · `db:push` no longer runs the seed · Sarvam cost not measured · Details → [`milestones/M9.md`](milestones/M9.md)

**2026-11-11 · M9 Build A — Trace, ops page, failure alert, health check · ✅ Shipped (commit 6587b95, merged to main f66f43f, pushed)**
Every request gets a trace id and its steps land in `ops_events` (with LLM token counts); `/ops` shows error rate, rejected LLM answers, tool latency, queue, spend and each error's timeline; a 5-minute watcher sends one WhatsApp alert per problem per 15 minutes; 6 failure drills pass.
Deno 1,469 + root 211 + web 244, `npm run check` green; migration pushed without the seed (demo data intact), a forced drill raised one WhatsApp alert via the cron · ops page already shows 2 tools over the 500 ms target · Details → [`milestones/M9.md`](milestones/M9.md)

**2026-11-11 · M9 — Production readiness · ✅ Plan approved**
Five builds: request trace + ops page + WhatsApp failure alert + health check; pause switch and rollback; evals on Sarvam Tests (spike first for cost) with an evals page; CI; unit economics, incident write-ups, runbook, README, then CP3.
~15 h over two days; 7 decisions for Saim; SPEC §10/§12/§17 changes proposed, not made · Details → [`milestones/M9.md`](milestones/M9.md)

**2026-11-08 · Future build (parked by Saim) — "Needs your check" for Asha's claims and disputes · 💡 Idea**
Today a "I paid ₹5,000" claim and a dispute reach the owner inside Asha's call summary (claim with Confirm received / Not received). Parked for later: a separate "⚠️ Check this" WhatsApp message per claim/dispute (dispute buttons: I'll call / Asha call again / Resolved), a "Needs your check" box on the dashboard, the owner's choice carried into Asha's next call, and Munshi opening with "N things need your check". About 1.5–2 h.

**2026-11-08 · M7 B2 follow-up — Light blue theme back, WhatsApp "/" commands · ✅ Committed and merged**
Saim chose the very light blue theme again (faces, dialling screen, watermark kept). 13 slash commands handled in code and registered with Meta; "call Munshi" mid-conversation now sends the link. Commit 798e30e, merged into main.

**2026-11-08 · M7 Build B2 — Call screen + beige/brown/gold theme · ✅ Built (awaiting gate, deploy, smoke, commit)**
Dialling screen, drawn faces (female Asha, male Munshi, shopkeepers from an explicit fake-name list, neutral when unknown) with an AI tag, two-lane gold arrows, "…" bubble, Sarvam speech events first for the person's arrow; beige / cream / brown theme with light-brown card borders and gold accents, faint centred logo, favicon. Munshi's read-backs no longer say "his" about women shopkeepers.
Deno 1370 + root 204 + web 227, `npm run check` green; contrast + raw-colour scan in theme.test.ts · Details → [`milestones/M7.md`](milestones/M7.md)

**2026-11-07 · M7 Build B2 — Call screen + beige/brown/gold theme · 🟡 Planned**
Dialling screen, two avatars, two-lane who-is-speaking arrows and live transcript on the phone page and Munshi; one warm theme (beige #F5EDE0, brown #4A2E1A text, gold #C9A227 borders only, faint logo) on every screen, contrast checked by a test.
~2.5–3 h, web only; 3 look decisions for Saim · Details → [`milestones/M7.md`](milestones/M7.md)

**2026-11-07 · M8 — Munshi, the owner's call line · 🟡 Planned (approved)**
Owner calls a male, casual Sarvam agent from a one-time WhatsApp link; it answers anything about the book and acts only after a spoken yes checked in code; WhatsApp only on request; tools under 0.5 s.
~9.5 h in 3 builds; SPEC §6.10 + M8 Munshi / M9 Evals / M10 Go-live; ADR-0018 · Details → [`milestones/M8.md`](milestones/M8.md)

**2026-11-07 · M7 Build B1 — Asha remembers past calls · 🟡 Planned (approved)**
get_dues adds a code-built history of the last 3 calls (fixed reasons + at most one short, number-free "their words" phrase), same DB trip; Asha v6 memory lines; reusable by Munshi.
Not RAG (direct lookup by shopkeeper id) · closes backlog 9 and 10 · Details → [`milestones/M7.md`](milestones/M7.md)

**2026-11-07 · M7 Build A — Spoken summary, bot profile, buttons · ✅ Done (awaiting commit)**
sarvam-105b writes a casual spoken voice-note summary (figures and names checked in code, else today's version), Menu list + reply buttons, cleaner layout; Meta accepted the logo + About line on the test number. Next: Asha memory (B1), then Munshi, the owner's call line.
Deno 985 + root 99 + web 82, gate green, deployed; tester caught "5thousand"/"5k" slipping the number check (fixed); smoke OK by Saim · Built locally (no cloud) · Details → [`milestones/M7.md`](milestones/M7.md)

**2026-11-04 · M6 — Voice notes, translation, insights · ✅ Deployed + smoked (awaiting commit)**
Voice notes in (Saaras v3 translit, picked by spike) and out (Bulbul: Telugu v4-flash Kavitha, Hindi/English v3 Kavitha), English under Telugu, insights ring chart, dashboard behind a signed 24-hour link. Live smoke found two bugs, both fixed: "will pay … by 15th" read as a payment (parser), and natural sentences couldn't reach due alert / insights / dashboard / score (brain prompt v2).
Deno 818 + web 77 + root 60, gate green; smoke 7/8 pass + 1 skipped by Saim; seed re-ran on db:push; Sarvam ≈ ₹6–8 · Localhost dev dashboard opens without the link ("Local demo mode"; server lock unchanged) · Details → [`milestones/M6.md`](milestones/M6.md), [ADR-0017](adr/ADR-0017-voice-notes-translate-dashboard-link.md)

**2026-11-03 · M5 — Reminder loop · ✅ Done (awaiting commit)**
Due alert with Remind / Remind all (10 a time), simulated text calls (Asha vs a Gemini shopkeeper), Asha v3 memory + tone ladder, follow-up agent with WhatsApp summaries, promise check, reliability score, pg_cron jobs.
634 Deno tests + gate green; smoke 6/8 (11 simulated calls all followed up); fixed a placeholder Vault secret; Meta block cleared by human verification · Details → [`milestones/M5.md`](milestones/M5.md)

**2026-11-03 · M4 — WhatsApp core · ✅ Done**
Owner bot live on the Meta test number: ledger views, add credit / mark paid with Save cards, claims confirm, Sarvam LLM brain with Gemini fallback; unpublished app gets real messages once the WhatsApp account is linked to the app.
449 tests + gate green, phone smoke 6/8 passed (Telugu AI path still to try), never-expiring token · Details → [`milestones/M4.md`](milestones/M4.md)

**2026-11-02 · M3 — Sarvam switch + ledger · ✅ Done**
Asha now runs on Sarvam with 5 real tools against a new 100-shopkeeper ledger in a Mumbai database; ringing phone page; 4 voice calls passed (no amounts before identity, one promise per call, claims never touch the balance).
Fix after testing: a changed promise in the same call now updates it (Asha v2, not voice-tested). Spike passed, moved Oregon → Mumbai, gate green, ₹28 of free Sarvam credit used · Details → [`milestones/M3.md`](milestones/M3.md)

**2026-11-02 · Pivot to Easy Recovery AI · ✅ SPEC v2.0 approved**
Vapi → Sarvam Voice Agents (better voice and Hindi in testing); product becomes a WhatsApp-first credit-recovery assistant for a small trader, built to pitch to Sarvam.
Adds voice notes both ways, per-person reminders, Asha's memory and tone ladder, reliability score, own evals, feedback doc, unit economics · D1–D5 approved as suggested; CP2 → after M5 · Details → [`SPEC.md`](SPEC.md)

**2026-11-01 · Docs simplified · ✅ Done**
Plan + report merged into one file per milestone; `delivery/` removed; build log cut to 3 lines per entry; SPEC updated (M7 go-live pack → one file, voice stack per ADR-0007).
18 → 14 doc files (≈20 expected at go-live instead of ≈35); `agent/` renamed `voice-agents/` · commits `f78b78f`, `be0a3e0`

**2026-11-02 · CP1 — Review + score (M0–M2) · ✅ 8.6/10 (was 7.4)**
First score 7.4 (2 High: DOB could reach the audit log; a DB error in a tool failed the whole call); all 9 review issues plus 4 re-score findings fixed, 3 new ADRs.
Details → [`reviews/CP1.md`](reviews/CP1.md), [`reviews/scoreboard.md`](reviews/scoreboard.md) · reviewed `05b27d4` + fixes

**2026-11-02 · M2 — Platform core + tools + compliance · ✅ Done**
Webhook + 5 tools with verify-before-disclose in code, calling rules (switchable), call authorisation, customer picker; voice test found 8 issues (silent replies, hang-up mid-handover, slow tools…), all fixed; tools ~0.5 s.
108 + 55 + 31 tests, gate passed, smoke 12/12, 6 voice calls · Details → [`milestones/M2.md`](milestones/M2.md) · next: commit, CP1

**2026-11-01 · M1 — Voice spike · ✅ Done**
English and Hinglish browser calls work, replies in ~1.2 s; voice model moved off Gemini (too slow/overloaded) to Vapi-hosted GPT; Deepgram chosen for Hindi; 6/6 smoke tests, $0.65 credit.
Details → [`milestones/M1.md`](milestones/M1.md), [ADR-0007](adr/ADR-0007-voice-stack.md) · commits `03998a9`, `7b38f96` (pushed)

**2026-10-31 · M0 — Foundation · ✅ Done**
Strict TypeScript workspace with owner rules in lint, light-blue dashboard shell, Supabase schema (16 tables, RLS on all) with 8 fake borrowers, shared server core at 100% test coverage.
Details → [`milestones/M0.md`](milestones/M0.md) · commits `fb3d15d`, `fa175af` (pushed)

**2026-10-31 · Scope finalised · ✅ Done**
Core = collections voice agent + shared follow-up agent (rules first, agent for judgement, always writes a note); English + Hindi; lead qualification pending; Telugu and onboarding dropped.
Details → [`SPEC.md`](SPEC.md) · commit `181dd35` (pushed)

**2026-10-31 · Project setup · ✅ Done**
SPEC, four guidelines and eight build agents adapted from Saim's company SDLC rules; lean workflow with a quality gate every milestone and three checkpoints.
Details → [`SPEC.md`](SPEC.md), [`guidelines/`](../guidelines/) · commit `816c6d6` (pushed)
