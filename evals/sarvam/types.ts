// evals/sarvam/types.ts
// Shapes shared by the Sarvam Tests evals (M9 Build C): a case as code, the fake data it needs,
// what the database must look like afterwards, and one case's result. Kept apart so cases, data,
// checks and the runner do not import each other in a circle.

/** One credit on the eval shopkeeper's book, dated relative to the run day. */
export interface SetupCredit {
  readonly amount: number;
  /** Days before the run day the goods were given. */
  readonly givenDaysAgo: number;
  /** Days before the run day it fell due; negative means due in the future. */
  readonly dueDaysAgo: number;
}

/** The fake shopkeeper a case calls. Each run creates fresh ones under its own eval owner, so
 * the real owner's book, alerts, insights and scores never see them. */
export interface CaseSetup {
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly credits: readonly SetupCredit[];
  /** Promises already broken, each this many days ago (drives Asha's tone level). */
  readonly brokenPromiseDaysAgo: readonly number[];
}

/** What the tools and the book must show after the call, checked in code (no judge). */
export interface CodeExpectation {
  /** Tools that must have run successfully at least once. */
  readonly mustCall: readonly string[];
  /** Tools that must never have run successfully. */
  readonly neverCall: readonly string[];
  /** Promises saved on this call. */
  readonly promises: 0 | 1;
  /** "I already paid" claims saved on this call. */
  readonly claims: 0 | 1;
}

export interface Behaviour {
  readonly name: string;
  readonly description: string;
}

export interface EvalCase {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** Who the simulated caller is and how they behave. */
  readonly scenario: string;
  /** Graded by Sarvam's judge, one verdict each. */
  readonly behaviours: readonly Behaviour[];
  readonly maxTurns: number;
  readonly setup: CaseSetup;
  readonly expect: CodeExpectation;
}

/** One tool call as audited by our own tool server (tool_events). */
export interface AuditedTool {
  readonly tool: string;
  readonly ok: boolean;
}

/** What one eval call left in the database. */
export interface CallEvidence {
  readonly tools: readonly AuditedTool[];
  readonly promises: number;
  readonly claims: number;
  /** Sum of confirmed credits minus confirmed payments, before and after the call. */
  readonly outstandingBefore: number;
  readonly outstandingAfter: number;
}

export interface CheckResult {
  readonly id: string;
  /** A critical failure fails the release gate on its own (money, identity). */
  readonly critical: boolean;
  readonly passed: boolean;
  /** Empty when passed; otherwise what went wrong (fake data only). */
  readonly detail: string;
}

export interface Verdict {
  readonly name: string;
  readonly passed: boolean;
  readonly reasoning: string;
}

export interface TranscriptTurn {
  readonly role: string;
  readonly content: string;
}

export interface CaseResult {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  /** Sarvam's judge: one per expected behaviour, plus one combined "Guardrails". */
  readonly verdicts: readonly Verdict[];
  /** Our own checks against the database. */
  readonly checks: readonly CheckResult[];
  readonly transcript: readonly TranscriptTurn[];
  readonly passed: boolean;
}
