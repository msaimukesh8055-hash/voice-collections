# Coding Standards

Applies to all code in this repo — frontend (React + Vite + Tailwind), backend (Supabase Edge Functions on Deno), evals (Node scripts), and agent config. Every agent and every manual change follows this file.

## Project-wide rules (non-negotiable)

- **TypeScript only**, `strict: true`. No plain JavaScript files.
- **No `any`.** Use real types. For "may be missing" values use `Thing | null` and narrow with guard clauses. Derive types from Zod schemas (`z.infer<typeof Schema>`) so runtime checks and types never drift.
- **File path comment** on line 1 of every source file, e.g. `// supabase/functions/vapi-webhook/index.ts`.
- **No anonymous inline handlers in JSX.** Always a named function: `onClick={handleStartCall}`, never `onClick={() => ...}`.
- **No hardcoded secrets, URLs or keys.** Environment variables only (see `security.md`).
- **Fake data only.** No real names, phone numbers, PAN, Aadhaar or account numbers anywhere.

## Principles

- Code is for humans first. Names say *what*, not *how*.
- **KISS, YAGNI** — build what the current milestone needs, nothing speculative.
- **No duplication** — extract and reuse. One source of truth per rule, schema, or constant.
- **Boy Scout rule** — leave touched code cleaner than you found it.
- **Be consistent** — follow the patterns already in the codebase before inventing new ones.
- **Single responsibility** — a function does one thing; a module owns one domain.
- Prefer **functions and modules** over classes. Depend on interfaces/types, not concrete implementations (pass dependencies in, e.g. a `db` or `llm` client, so they can be faked in tests).

## Immutability (critical)

- Never mutate inputs or shared objects. Return new objects (spread, `map`, `filter`).
- `const` by default; `readonly` on type fields and arrays where practical.
- React state is always replaced, never mutated.

## Size limits

| Thing | Ideal | Hard max |
|---|---|---|
| Function | 3–10 lines | 50 lines |
| File | 200–400 lines | 800 lines |
| Nesting depth | 1–2 | 4 |
| Parameters | 1–2 | 3 (use an options object beyond that) |

- Use **guard clauses / early returns** to flatten logic.
- Extract complex conditions into named booleans or functions: `isWithinCallingHours(now)`.
- **No flag arguments** — split `sendMessage(isUrgent)` into two functions.
- **No switch ladders for routing** (e.g. intent or tool dispatch) — use a typed lookup map.

## Naming

- Functions: verbs (`lookupLoan`, `logPromiseToPay`). Types/components: nouns (`CallSummary`, `TranscriptView`).
- Domain names, not generic ones: `complianceRules.ts`, not `utils.ts` or `helpers.ts`.
- **No magic numbers or strings** — named constants: `CALLING_HOURS_START = 8`, `MAX_FALLBACK_ATTEMPTS = 2`.

## File organisation

- Organise **by feature/domain**, not by type: `web/src/features/calls/`, `supabase/functions/_shared/compliance/`.
- Many small files over few large ones.
- Shared Zod schemas live once in `supabase/functions/_shared/schemas/` and are imported by both web and functions (via import map). Never copy a schema.

## Error handling

- Handle errors explicitly at every level. **Never swallow** an error (no empty `catch`).
- Use a central **error-code map** (`ERROR_CODES`) for client-facing messages; log the detailed error server-side only.
- User-facing UI shows friendly messages; never raw errors or stack traces.

## Validation

- Validate **every** external input at the boundary with Zod: HTTP request bodies, Vapi webhook payloads, tool arguments, LLM JSON output, env vars.
- Fail fast with a clear error code.
- Never trust external data — API responses, user input, LLM output, file content.

## Comments

- Explain **why**, not what. Document assumptions, edge cases, and compliance reasons.
- Never commit commented-out code — delete it.
- `TODO` is allowed only with a link to an item in `docs/reviews/review-backlog.md`.

## React rules

- **New page = one self-contained file first.** Split into sub-components only after it works end-to-end.
- Forms: plain `useState` unless 5+ fields or async validation; then `react-hook-form` + Zod resolver.
- Wrap pages with forms or live call state in an **error boundary**.
- **Routes:** only add a route after its component file exists and passes lint + typecheck. A bad route import breaks the whole app.
- Explicit return types on all service/data functions (functions that call APIs or Supabase).
- **i18n:** dashboard is English-only in v1. Agent language content (greetings, fallback lines, few-shot examples) must exist for **every** supported language (EN, HI) — a missing language version is a bug.
- One light theme: beige background, dark brown text, thin gold borders and accents (gold never for body text), faint logo watermark, across all screens (Saim, 2026-11-07; was very light blue). Use the shared Tailwind tokens, no ad-hoc colours; text must meet WCAG AA contrast on the beige background.

## Performance

- No premature optimisation.
- No database queries inside loops; batch or join.
- Every query feeding a list has a `limit`.
- Every external HTTP call (Gemini, Vapi) has a timeout.

## API design

- Data endpoints: REST, plural nouns, versioned: `/v1/calls`, `/v1/loans/:id`.
- Vapi's server URL is a single webhook by design; it dispatches by message type and tool name via a lookup map (see ADR).

## Quality checklist (before marking work done)

- [ ] Lint passes with `--max-warnings=0`; typecheck passes
- [ ] File path comment on every new source file
- [ ] No `any`, no inline JSX handlers, no `console.log`
- [ ] Functions < 50 lines, files < 800 lines, nesting ≤ 4
- [ ] No mutation; no magic numbers; no hardcoded secrets/URLs
- [ ] Errors handled and mapped; inputs validated with Zod
- [ ] TODOs link to the backlog
