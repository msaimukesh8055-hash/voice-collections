# ADR-0011: Calling hours and attempt limits can be switched off for testing

## Status
Accepted (Saim, M2, 2026-11-01). Recorded at CP1 (2026-11-02). Amends SPEC §9 for the test period only.

## Context
SPEC §9 and `security.md` make calling hours (08:00–19:00 IST) and attempt limits (3 a day, 7 in 7 days) code-enforced rules. During M2, voice testing happened late at night and many times a day. The rules blocked the tests themselves.

## Decision
- Two database switches on `demo_settings`: `calling_hours_enabled` and `call_limits_enabled`. Both default to **off** while building and testing.
- The rules themselves stay in code, fully tested (including boundary times and the 4th/8th attempt). The smoke test switches calling hours on and proves a 21:00 call is blocked.
- Do-not-call is **always on**. So are verify-before-disclose and the daily cap on failed DOB attempts. None of them can be switched off.
- **Switch-on point:** both switches are turned **on** for the demo and go-live. M4 adds them to the demo controls, and the M7 go-live checklist confirms they are on.

## Alternatives considered
1) Always on, and test only with the demo clock: safest, but every test call needs a clock change first.
2) An environment flag: harder to change mid-demo, and it doesn't show on the dashboard.

## Consequences
- Until the switch-on point, the deployed system doesn't enforce hours or attempt limits. This is acceptable only because all borrowers are fake.
- The demo can show the rules working by flipping a switch, which is a good talking point.
- Risk: forgetting to switch them on. The go-live checklist item is the guard.
