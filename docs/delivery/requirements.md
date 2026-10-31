# Business Requirements — Suvidha Finance Voice Collections Pilot

**Client:** Suvidha Finance (fictional NBFC) · **Prepared by:** Saim (Platform FDE) · **Version:** 1.0

## 1. Background

Suvidha Finance's collections team calls borrowers 1–90 days past due. Calls are repetitive, inconsistent in quality, and hard to audit for RBI fair-practice compliance. Follow-ups depend on agents remembering what was promised.

## 2. Objectives

| # | Objective | Measure |
|---|---|---|
| O1 | Automate early-bucket collection calls in English and Hindi | % of calls completed by AI without human help |
| O2 | Increase promises to pay | Promise-to-pay rate |
| O3 | Guarantee compliance on every call | Compliance pass rate = 100% |
| O4 | Never lose context between calls | Follow-up note present for 100% of completed calls |
| O5 | Escalate sensitive cases to humans with full context | Handoffs with summary = 100% |

## 3. Scope

**In scope (pilot):** outbound collections conversations (simulated as browser calls), identity verification, dues disclosure, negotiation, payment links, policy Q&A, human handoff, post-call follow-up decisions, manager dashboard, quality evaluation.
**Out of scope (pilot):** live telephony, real payments, integration with the production LMS, WhatsApp/SMS, languages other than English and Hindi.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR1 | Agent discloses it is an AI and the call is recorded at the start of every call | Must |
| FR2 | Agent confirms the right person; reveals nothing to anyone else | Must |
| FR3 | Agent verifies identity (DOB) before sharing any loan detail; max 2 attempts | Must |
| FR4 | Agent states overdue amount, EMI, due date and late fee exactly as in the loan system | Must |
| FR5 | Agent recognises intents: will pay, cannot pay, already paid, dispute, wrong person, wants human, policy question | Must |
| FR6 | Agent captures promise date, amount and payment mode and validates them against policy | Must |
| FR7 | Agent answers policy questions only from approved documents; otherwise says it will check with the team | Must |
| FR8 | Agent rephrases when it doesn't understand and offers a human after 2 failures | Must |
| FR9 | Agent transfers to a human with a summary on dispute, request, or hardship | Must |
| FR10 | Agent remembers the last promise and latest note from previous calls | Must |
| FR11 | After each call: summary, compliance check with evidence, follow-up decision and note | Must |
| FR12 | Follow-up agent schedules promise checks and retries within calling hours and attempt limits | Must |
| FR13 | Manager dashboard shows KPIs, calls, transcripts, audit trail, follow-ups, human queue | Must |
| FR14 | A new agent version cannot go live unless evaluation passes (compliance 100%) | Must |

## 5. Compliance requirements (RBI fair-practice aligned)

Calling hours 08:00–19:00 IST · attempt limits · do-not-call honoured · no threats, abuse or shaming · no third-party disclosure · figures only from the system of record · full audit trail per call.

## 6. Non-functional requirements

Voice response < 1.5 s typical · English + Hindi (incl. Hinglish) · secrets never in the browser · all data access via server · audit records retained per call.

## 7. Assumptions

- Pilot uses fictional borrower data only.
- Payment confirmation is simulated (demo toggle) in place of an LMS/payment-gateway feed.
- Browser calls stand in for telephony; the move to phone lines is documented separately.
