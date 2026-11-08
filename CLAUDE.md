# CLAUDE.md — Easy Recovery AI

## What this is

A portfolio prototype, **Easy Recovery AI**: a WhatsApp-first credit-recovery assistant for a small trader in Anantapur (fake persona Srinivas Reddy, Sri Lakshmi Traders) with ~100 fake shopkeepers. Built to pitch to **Sarvam AI**, delivered as a mock client implementation — requirements → design → build → test → go-live. Full scope: `docs/SPEC.md` (v2.0; v1.3 Suvidha/Vapi is in git history).

- **WhatsApp owner bot** (Meta test number): ledger, add credit by text or voice note, mark paid, due alerts with per-person Remind, insights, voice notes both ways
- **Asha**, a reminder voice agent on Sarvam (browser calls; Saim plays Ramesh) with memory and a tone ladder; other shopkeepers get simulated text calls
- **Follow-up agent** — rules for clear cases, agent for judgement calls, always writes a note Asha reads next call, sends the owner a WhatsApp summary
- **Reliability score**, **dashboard**, **own evals + release gate**, platform feedback doc, unit economics

**Owner:** Saim (product manager; makes product decisions). **Claude** writes all code and explains engineering concepts in plain English.

## Always read first

| File | What it governs |
|---|---|
| `docs/SPEC.md` | Scope, milestones, acceptance criteria |
| `guidelines/workflow.md` | Milestone pipeline, approval stops, scoring, git |
| `guidelines/coding-standards.md` | How code must look |
| `guidelines/testing.md` | How code is tested; unit tests vs agent evals |
| `guidelines/security.md` | Secrets, data access, BFSI compliance rules |
| `docs/architecture.md` + `docs/adr/` | Architecture and decisions (once created) |

Agents in `.claude/agents/`: `architect`, `designer`, `implementer`, `tester`, `fixer`, `reviewer`, `refactorer`, `evaluator`. The main session is the **coordinator**: it runs them in the order defined in `guidelines/workflow.md` and holds the approval stops.

## Owner's rules (non-negotiable)

- **Plan first.** No code until Saim says "go ahead" or "confirmed" on the milestone plan.
- **Concise, direct, plain English.** No jargon without a one-line explanation.
- **TypeScript always.** No `any`.
- **UI theme: very light blue background, dark navy text, light-blue borders, mid-blue accents, faint logo watermark, across all screens** (project exception to the global "dark themes preferred" rule; Saim tried beige/brown/gold on 2026-11-07/08 and went back to light blue on 2026-11-08). One light theme, no dark toggle.
- **Prompts and experiment choices are Saim's decisions.** Explain key design decisions in plain English at each milestone.
- **No hardcoded secrets** — environment variables only.
- **No anonymous inline JSX handlers** — named functions only.
- **File path comment** at the top of every source file.
- **Never commit without asking. Never push** unless explicitly told.
- **Fake data only.**

## Stack

| Layer | Choice |
|---|---|
| Voice platform | Sarvam Voice Agents (browser web calls via `sarvam-conv-ai-sdk`; no phone numbers) |
| Owner interface | Meta WhatsApp Cloud API (test number) |
| WhatsApp brain, follow-ups, simulated calls | Sarvam LLM `sarvam-105b` (fixed commands parsed in code first) |
| Speech (voice notes) | Sarvam Saaras (speech-to-text), Bulbul (text-to-speech) — Telugu, Hindi, English, code-mixed |
| Eval judge, fallback | Google Gemini (free tier) |
| Frontend | Vite + React + TypeScript + Tailwind (very light blue theme) |
| Backend | Supabase Edge Functions (Deno) |
| Database | Supabase Postgres |
| Validation | Zod (schemas shared between web and functions) |
| Tests | Vitest + React Testing Library, `deno test`, Playwright |
| Hosting | Vercel (web), Supabase (functions + DB) |

## Repo layout (target)

```
web/                      Vite React dashboard + borrower phone page
supabase/
  migrations/             SQL schema + RLS
  seed.sql                1 fake owner, 100 fake shopkeepers, ledger history
  functions/
    _shared/              schemas/, compliance/, tools/, db, errors, env
    whatsapp-webhook/     owner messages from Meta
    sarvam-tools/         Asha's tool calls from Sarvam
    calls-api/            call authorise, Sarvam URL proxy, phone page, dashboard
voice-agents/             the product's voice agents as code: prompt, languages, voice, model, tools (pushed to Sarvam via MCP)
evals/                    scenarios, simulator, judge, runner
docs/                     SPEC, architecture, ADRs, BUILD-LOG, milestones (plan + results), reviews (checkpoints)
guidelines/               shared standards
```

## Budget guardrails

- Target spend ₹0; hard cap ₹1,000.
- Sarvam voice is ₹3.50/min + GST: **voice minutes are for manual testing and the demo only.** All bulk testing runs as text evals.
- Never add a paid service or phone number without asking.

## Mode

**Lean mode** (8-hour build) — see `guidelines/workflow.md`:
- Every milestone: short plan → STOP → build + tests → **quality gate** (build, lint, typecheck, tests, standards, security, deployed, smoke test) → STOP → ask to commit.
- Full review (`reviewer` + `evaluator`) only at checkpoints CP1 (after M2), CP2 (after M5), CP3 (after M7, before go-live, with `refactorer`).
- **Quality never relaxes; paperwork does.** If a time box runs out, cut scope using the SPEC cut order — never skip the quality gate.
