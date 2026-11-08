// evals/munshi/types.ts
// Shapes shared by Munshi's text evals (M8 C1): a scenario, one finished run as the checks see
// it, and a check with its result. Kept apart so scenarios, checks and the runner do not import
// each other in a circle.
import type { BookEntry } from '../../supabase/functions/_shared/db/book-repository.ts';
import type { VoiceAction } from '../../supabase/functions/_shared/db/voice-action-repository.ts';
import type { SendWhat } from '../../supabase/functions/_shared/owner-tools/schemas.ts';
import type { Language } from '../../supabase/functions/_shared/schemas/shopkeeper.ts';
import type { OwnerConversation } from '../../supabase/functions/_shared/simulator/owner-conversation.ts';
import type { OwnerScript } from '../../supabase/functions/_shared/simulator/owner-persona.ts';

/** One entry Munshi's confirmed change must have added. */
export interface ExpectedEntry {
  readonly shopkeeperId: string;
  readonly kind: 'credit' | 'payment';
  readonly amount: number;
  /** Checked only when given. */
  readonly dueDate?: string;
}

/** What the book must look like after the call; anything left out must not change at all. */
export interface ExpectedOutcome {
  readonly entries?: readonly ExpectedEntry[];
  readonly reversed?: readonly string[];
  /** Claim entry id → how it was settled; every other open claim stays open. */
  readonly claims?: Readonly<Record<string, 'confirmed' | 'rejected'>>;
  /** Shopkeeper ids Asha was asked to call. */
  readonly reminders?: readonly string[];
  readonly sends?: readonly SendWhat[];
}

/** The book as the checks compare it, before and after the call. */
export interface BookSnapshot {
  readonly entries: readonly BookEntry[];
  readonly reversals: readonly string[];
  readonly queued: readonly string[];
  readonly kicked: readonly string[];
  readonly actions: readonly VoiceAction[];
}

export interface EvalRun {
  readonly language: Language;
  /** The day label Munshi was given (its figures may be spoken). */
  readonly today: string;
  /** Values Munshi must never say (the owner call token). */
  readonly secrets: readonly string[];
  readonly conversation: OwnerConversation;
  readonly before: BookSnapshot;
  readonly after: BookSnapshot;
}

export interface Check {
  readonly id: string;
  /** A critical failure fails the whole eval run (M8 test list "Pass"). */
  readonly critical: boolean;
  /** Null when it passed; otherwise what went wrong (fake data only). */
  readonly test: (run: EvalRun) => string | null;
}

export interface CheckResult {
  readonly id: string;
  readonly critical: boolean;
  readonly passed: boolean;
  readonly detail: string | null;
}

export interface MunshiScenario {
  /** "01" … "15" */
  readonly id: string;
  readonly title: string;
  readonly language: Language;
  readonly owner: Omit<OwnerScript, 'language'>;
  /** Start call this long before the conversation (default 30 s; the wrap-up run uses 7:10). */
  readonly acceptedAgoMs?: number;
  readonly outcome?: ExpectedOutcome;
  /** Scenario-specific checks on how the call went (tool choice, asking which, …). */
  readonly flow?: readonly Check[];
}
