# User Stories — Suvidha Finance Voice Collections Pilot

Format: *As a … I want … so that …* · Acceptance criteria in Given/When/Then.

## Borrower

**US1 — Know who is calling**
As a borrower, I want to know I'm speaking to an AI assistant and that the call is recorded, so that I can decide how to respond.
- Given a call starts, when the agent speaks first, then it states its name, that it is an AI assistant from Suvidha Finance, and that the call is recorded.

**US2 — Privacy**
As a borrower, I want my loan details shared only with me, so that my family or colleagues don't learn about my debt.
- Given the person says they are not the borrower, when the agent responds, then it apologises and ends without mentioning a loan or amount.
- Given identity is not verified, when the agent tries to look up the loan, then the system refuses.

**US3 — Flexible repayment**
As a borrower who can't pay in full, I want to agree a later date or a part payment, so that I can stay on track.
- Given I say I can pay half next Friday, when the agent records the promise, then the amount and date are validated against policy and read back to me.

**US4 — Already paid**
As a borrower who already paid, I want the agent to note it without pressuring me, so that I'm not chased wrongly.
- Given I say I paid on a date, when the agent captures it, then it marks the claim for verification and does not ask for payment.

**US5 — Speak to a person**
As a borrower, I want to reach a human when I need to, so that disputes and difficult situations are handled properly.
- Given I ask for a person or dispute a charge, when the agent responds, then it transfers with a summary.

**US6 — My language**
As a Hindi-speaking borrower, I want the call in Hindi or Hinglish, so that I understand everything.

## Collections manager

**US7 — See performance**
As a collections manager, I want KPIs (contact, verification, promise-to-pay, promises kept, escalations, compliance), so that I can judge the pilot.

**US8 — Never lose context**
As a collections manager, I want every call to end with a follow-up decision and a note, so that the next call continues where the last one ended.
- Given a borrower broke a promise, when the next call starts, then the agent refers to the broken promise.

**US9 — Safe changes**
As a collections manager, I want new agent versions blocked unless they pass evaluation, so that a bad prompt never reaches customers.

## Human agent

**US10 — Context on handoff**
As a human agent, I want each escalated case to arrive with a summary and reason, so that the customer doesn't repeat themselves.

## Compliance officer

**US11 — Proof of compliance**
As a compliance officer, I want each call's compliance result with transcript evidence and a full tool audit trail, so that I can prove fair-practice adherence.
