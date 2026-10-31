# Testing Standards

Two different kinds of testing exist in this project. Keep them separate.

| | Unit / integration / E2E tests | Agent evals |
|---|---|---|
| Question answered | Does the **code** work? | Does the **AI agent** behave? |
| Uses real LLM? | Never — LLM and Vapi are faked | Yes (free Gemini tier) |
| Speed | Milliseconds | Minutes |
| Lives in | next to the code (`*.test.ts`) | `evals/` |
| Run with | `npm test` / `deno test` | `npm run evals` |

## Coverage

- **80% minimum** overall.
- **100% required** for:
  - Money: dues, overdue amount, late-fee and part-payment calculations
  - Identity verification (`verify_customer`)
  - Compliance rules: calling hours, attempt limits, third-party disclosure, "verify before disclose"
  - Webhook authentication (Vapi secret check)
  - Tool argument / LLM-output validation

## Test types

- **Unit** — single functions, rules, components. Required for all new logic.
- **Integration** — Edge Function handlers end-to-end with a test database or faked Supabase client; webhook payload → database row.
- **E2E (Playwright)** — only the critical dashboard flows: open call detail from the calls list; human-queue item shows the handoff summary. Voice calls themselves are **not** E2E-tested (no microphone in CI); evals cover agent behaviour.

## TDD

- **Mandatory for backend logic**: tools, compliance rules, money calculations, webhook handling, validation.
  1. **RED** — write a failing test for one scenario
  2. **GREEN** — write the minimum code to pass
  3. **REFACTOR** — clean up with tests green
  4. Repeat per scenario
- **UI code**: tests written alongside the component (not necessarily first).
- Run tests after every change. Refactor only on green.

## Structure

- **Arrange–Act–Assert**, visibly separated.
- One logical assertion per test (max 3 related assertions).
- Readable names via `describe` / `it`:
  `describe("verifyCustomer") › it("refuses loan details when DOB does not match")`
- At least **one negative test** per tool/endpoint (bad input, unauthorised, not found).
- Shared test data in fixtures (`__fixtures__/`), not copy-pasted.

## Quality

- Independent and isolated; no shared mutable state.
- Deterministic — no real time, network, or randomness. Inject a clock (`now: () => Date`) for calling-hours rules.
- Unit tests < 100 ms each.
- No flaky tests. A flaky test is a bug.
- **Fix the code, not the test** — unless the test is wrong, and then say so in the report.

## Frameworks

| Area | Unit | Mocking | Integration | E2E |
|---|---|---|---|---|
| Web (Vite/React) | Vitest + React Testing Library | `vi.mock`, injected fakes | Vitest | Playwright |
| Edge Functions (Deno) | `deno test` | injected fakes | `deno test` against handler | — |
| Evals (Node) | Vitest for judge/parsers | — | — | — |

## Agent evals (summary — full design in SPEC)

- ~24 scenarios: persona × intent × language (EN/HI/TE).
- An LLM plays the customer; the agent runs with the same prompt and tool logic; an LLM judge scores.
- Metrics: task completion, intent accuracy, entity accuracy, compliance (zero-tolerance items), correct handoff, quality (1–5).
- Every prompt change re-runs evals; results compared with the previous version in `docs/reports/evals-vN.md`.

## Reporting

After each test run, save `docs/reports/<milestone>-test-results.md` with:
- Totals: run / passed / failed / skipped, coverage %
- Each failure: test name, error message, likely cause
- Failure patterns (e.g. "3 of 4 failures are Telugu date parsing")
- Recommendations
