# Delivery Workflow

How every milestone in `docs/SPEC.md` is delivered. The main Claude session acts as **coordinator**: it calls the agents in `.claude/agents/` in order, talks to the user, and holds the approval stops. Agents never talk to the user directly and never start the next phase themselves.

## Mode: LEAN (current)

Process is scaled to the 8-hour deadline. **Quality gates never relax; paperwork does.** Every milestone must run properly before it is called done — fewer agents run, not fewer checks.

### Every milestone

```
designer (short plan + test list) ─► [STOP 1: approve plan]
 ─► implementer (TDD on critical logic) + tester ─► fixer (only if something fails)
 ─► quality gate ─► smoke test ─► [STOP 2: show results] ─► ask to commit
```

| Step | Who | Output |
|---|---|---|
| 1 | `designer` | **Plan** section of `docs/milestones/<M>.md` — goal, decisions, files, test list |
| **STOP 1** | user | Approves plan (or overrides decisions) |
| 2 | `implementer` + `tester` | Code + tests; **Results** section appended to `docs/milestones/<M>.md` (built / deviations / gaps / test totals / fixes) |
| 3 | `fixer` | Only when build, lint, typecheck or tests fail |
| 4 | coordinator | **Quality gate** (below) — all must pass |
| 5 | coordinator + user | **Smoke test** — the milestone's "Done when" from SPEC, run for real (e.g. an actual voice call) |
| **STOP 2** | user | Sees gate results + smoke test outcome; approves |
| 6 | coordinator | Updates `docs/BUILD-LOG.md`, then asks permission to commit (the log entry is committed with the work) |

### Build log

`docs/BUILD-LOG.md` is the newest-first story of the build. The coordinator adds or updates an entry at **every** approval point — plan written (🟡 Planned), milestone done (✅ Done), checkpoint scored — in **exactly three lines**: (1) date · step · status, (2) the headline result or decisions in one sentence, (3) link to the milestone/review file + commit hashes. All detail (evidence, problems and fixes) goes in `docs/milestones/<M>.md` or `docs/reviews/CP<n>.md`, never repeated in the log.

### Quality gate (every milestone, non-negotiable)

- [ ] Build passes; typecheck passes; lint passes with `--max-warnings=0`
- [ ] All tests pass; critical areas (money, identity, compliance, webhook auth, validation) at 100% coverage
- [ ] `coding-standards.md` quality checklist satisfied
- [ ] `security.md` pre-commit checks satisfied
- [ ] Deployed pieces (Edge Functions, Vapi config) actually deployed and responding
- [ ] Smoke test passed end-to-end

A milestone that fails the gate is **not done**, regardless of time pressure. If the time box runs out, cut scope (SPEC cut order) — never quality.

### Checkpoints (full review)

At three checkpoints the full review agents run over everything built since the last checkpoint:

| Checkpoint | After | Runs |
|---|---|---|
| **CP1** | M2 (tools + compliance) | `reviewer` → `evaluator` |
| **CP2** | M5 (WhatsApp + reminder loop) | `reviewer` → `evaluator` |
| **CP3** | M7 (before go-live sign-off) | `refactorer` → `reviewer` → `evaluator` |

Outputs: `docs/reviews/CP<n>.md` (code review + score, and the refactor summary at CP3), row in `docs/reviews/scoreboard.md`. Critical/High issues are fixed before the next milestone starts.

### Agents used on demand

| Agent | When |
|---|---|
| `architect` | M0 (Init), and whenever a costly-to-reverse decision comes up (Decide → ADR) |
| `fixer` | Any failing check |
| `refactorer` | CP3 only (or earlier if a file passes 800 lines) |

### Switching to FULL mode

For production-style work, every milestone runs the full chain: `architect → designer → [STOP: plan] → [STOP: test list] → implementer → tester → fixer → reviewer → evaluator → [STOP: score]`.

## Approval rules

- Nothing is built until the user approves the plan.
- No phase starts automatically after a stop.
- At checkpoints the evaluator **always** runs before the stop — including re-runs and resumed sessions.
- Irreversible actions (dropping tables, deleting data, changing a schema that has data) always need explicit user choice.

## Code review interaction

- **Critical and High** issues: presented to the user one at a time as issue cards → Fix now / Skip / Explain / Backlog.
- **Medium and Low**: fixed or backlogged by the coordinator, listed in the review summary.
- Verdict: **Approve** (no Critical/High open) · **Warning** (High open) · **Block** (Critical open — must fix).

## Scoring

Evaluator scores each checkpoint (covering the milestones since the previous one) out of 10, four criteria at 25% each:

| Criterion | Checks |
|---|---|
| Architecture fit | Follows `docs/architecture.md` and ADRs; existing patterns reused |
| Completeness | Every item in the milestone plan built; nothing partial |
| Tests | All pass; coverage targets met (80% overall, 100% critical) |
| Standards | `coding-standards.md` + `security.md` checklists satisfied |

Rating: **< 7 Red** (rework) · **7 Yellow** (proceed with caution) · **> 7 Green**.
Missing report or artifact = 0 for that criterion. Score only what files prove. Re-runs overwrite, never duplicate.

## Git

- Local repository only. **Never push** unless the user explicitly says so.
- Branch per milestone: `feature/M2-loan-tools`. Merge to `main` locally after STOP 2.
- **Commit only after the user approves.** Message: `M2: add loan lookup and verify tools`.
- `.env` and secrets are always git-ignored.

## Where things live

```
docs/
  SPEC.md                 requirements + milestones
  architecture.md         current architecture
  adr/ADR-XXXX-*.md       decisions
  BUILD-LOG.md            newest-first diary of every step (links to the files below)
  milestones/<M>.md       one file per milestone: Plan (STOP 1) on top, Results (STOP 2) below
  reviews/CP<n>.md        checkpoint code review + score (+ refactor at CP3)
  reviews/scoreboard.md   one row per checkpoint
  reviews/review-backlog.md  deferred review items
  experiments.md          eval experiment log (M6)
```

## Fallbacks

If a tool or service is unavailable (Vapi, Supabase, Gemini quota), say so plainly, continue with what works locally, and record the gap in the milestone report. The pipeline does not stop silently.
