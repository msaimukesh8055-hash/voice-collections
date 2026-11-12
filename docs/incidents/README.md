# Incident write-ups

Short, blameless write-ups of real defects found while building Easy Recovery AI: what happened, how it was caught, the fix, and what now stops it coming back. All data is fake demo data; no real customer was affected.

| # | Date | Incident | Caught by | Status |
|---|---|---|---|---|
| 1 | 2026-11-04, again 2026-11-12 | [A promise to pay was turned into a money entry](2026-11-promise-read-as-money.md) | Live smoke test, then evals | Fixed twice; guarded in code |
| 2 | 2026-11-07 | [A spoken summary could say a figure the ledger never had](2026-11-spoken-figure-check.md) | Tester agent | Fixed |
| 3 | 2026-11-12 | ["Gave me" was read as new credit](2026-11-gave-me-read-as-credit.md) | Evals | Fixed |

## What these have in common

- **Every one is about money direction or a money figure**, the one area where a wrong answer costs the trader. None was a crash.
- **None reached the ledger.** Each stopped at a confirmation card that shows what was understood and saves nothing until the owner taps Save. That card is the control that bought time to find the bugs.
- **Two of the three were found by a test written before the bug was known** (the tester's cases, the eval set). The first was found by a person using the product, which is the expensive way.
- **The fix was always in code, not in the prompt.** A prompt change makes a wrong answer less likely; a code check makes it impossible to act on.
