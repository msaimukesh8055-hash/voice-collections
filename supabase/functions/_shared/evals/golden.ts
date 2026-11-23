// supabase/functions/_shared/evals/golden.ts
// Golden outcomes (Saim, 2026-11-23): what each eval case expects, in a form the deployed
// functions can read (they cannot read evals/). The data itself is generated from the case
// definitions in evals/ by `npm run evals:golden` into golden-cases.ts; evals/golden.test.ts fails
// if it drifts. Each row says what is expected, who checks it (our code or the AI judge), whether
// a failure blocks the release, and which stored check id or judge verdict holds its result.

export type GoldenTarget = 'asha' | 'munshi' | 'brain';

export interface GoldenRow {
  /** Where this row's result is stored: a code check id, or a judge verdict name. */
  readonly source: 'check' | 'verdict';
  readonly key: string;
  /** "Must call", "Promises saved", a behaviour's name, … */
  readonly label: string;
  /** What must happen, in plain words. */
  readonly expected: string;
  readonly checkedBy: 'code' | 'judge';
  /** One failure fails the release gate on its own. */
  readonly blocker: boolean;
}

/** The WhatsApp brain's expected command (null kind: it must not become one). */
export interface GoldenCommand {
  readonly kind: string | null;
  readonly name: string | null;
  readonly amount: number | null;
  /** With kind null: a read-only answer is fine, a money card is not. */
  readonly readsAllowed: boolean;
}

export interface GoldenCase {
  readonly id: string;
  readonly name: string;
  /** The expected outcome in a few words ("Logs 1 promise"). */
  readonly outcome: string;
  /** The simulated caller's script, or the owner's message for the brain. */
  readonly test: string;
  /** English meaning of a message that is not in English (brain only). */
  readonly meaning: string | null;
  readonly rows: readonly GoldenRow[];
  /** Brain only. */
  readonly command: GoldenCommand | null;
  /** Brain only: a money case fails the gate on its own. */
  readonly money: boolean;
}

export type Golden = Readonly<Record<GoldenTarget, readonly GoldenCase[]>>;
