// evals/munshi/__fixtures__/runs.ts
// Hand-built eval runs for the check tests: a timeline of owner lines, Munshi moves and tool
// replies, and the book before and after. FAKE DATA ONLY.
import type { BookEntry } from '../../../supabase/functions/_shared/db/book-repository.ts';
import type { ToolData } from '../../../supabase/functions/_shared/tools/types.ts';
import type {
  OwnerCallEvent,
  OwnerEndReason,
} from '../../../supabase/functions/_shared/simulator/owner-conversation.ts';
import type { Language } from '../../../supabase/functions/_shared/schemas/shopkeeper.ts';
import { EVAL_ENTRIES } from '../book.fixture.ts';
import type { BookSnapshot, EvalRun } from '../types.ts';

export const SECRET = 'ca000000-0000-4000-8000-0000000000b1';
const AT = '2026-11-07T06:30:00.000Z';

export function owner(say: string): OwnerCallEvent {
  return { kind: 'owner', say, at: AT };
}

export function munshi(say: string, endCall = false): OwnerCallEvent {
  return { kind: 'munshi', say, tool: null, endCall, at: AT };
}

export function tool(name: string, say: string, data: ToolData = {}): OwnerCallEvent {
  return { kind: 'tool', name, args: {}, result: { ok: true, say, data }, at: AT };
}

/** A successful tool call made with these arguments. */
export function called(name: string, args: Record<string, unknown>): OwnerCallEvent {
  return { kind: 'tool', name, args, result: { ok: true, say: 'ok', data: {} }, at: AT };
}

export function refused(name: string, code: string): OwnerCallEvent {
  return {
    kind: 'tool',
    name,
    args: {},
    result: { ok: false, code, say: 'Nothing was changed.' },
    at: AT,
  };
}

/** A prepare that stored a change (it has an action_ref). */
export function prepared(name: string, say: string): OwnerCallEvent {
  return tool(name, say, { action_ref: 'r1' });
}

export const EMPTY_BOOK: BookSnapshot = {
  entries: EVAL_ENTRIES,
  reversals: [],
  queued: [],
  kicked: [],
  actions: [],
};

export interface RunParts {
  readonly events: readonly OwnerCallEvent[];
  readonly language?: Language;
  readonly end?: OwnerEndReason;
  readonly after?: Partial<BookSnapshot>;
}

/** The transcript as the loop builds it: greeting, then one turn per owner line / Munshi turn. */
function transcriptOf(events: readonly OwnerCallEvent[]): EvalRun['conversation']['transcript'] {
  const turns: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'assistant', content: 'హా Srinivas అన్నా' },
  ];
  for (const event of events) {
    if (event.kind === 'tool' || event.say === '') continue;
    const role = event.kind === 'owner' ? 'user' : 'assistant';
    const last = turns.at(-1);
    if (last && last.role === role && role === 'assistant')
      last.content = `${last.content} ${event.say}`;
    else turns.push({ role, content: event.say });
  }
  return turns;
}

export function runOf(parts: RunParts): EvalRun {
  return {
    language: parts.language ?? 'en',
    today: 'Saturday, 2026-11-07',
    secrets: [SECRET],
    conversation: {
      transcript: transcriptOf(parts.events),
      end: parts.end ?? 'munshi_ended',
      toolCalls: parts.events.filter((event) => event.kind === 'tool').length,
      events: parts.events,
    },
    before: EMPTY_BOOK,
    after: { ...EMPTY_BOOK, ...parts.after },
  };
}

/** The book after one more entry was saved. */
export function withEntry(
  entry: Pick<BookEntry, 'shopkeeperId' | 'kind' | 'amount' | 'dueDate'>,
): Partial<BookSnapshot> {
  const saved: BookEntry = {
    ...entry,
    id: 'e7a1e000-0000-4000-8000-0000000009a1',
    entryDate: '2026-11-07',
    status: 'confirmed',
    paymentMode: null,
    createdAt: AT,
  };
  return { entries: [...EVAL_ENTRIES, saved] };
}

/** A clean read-only call: question, overview, answer, closing question, no, bye. */
export const GOOD_READ: readonly OwnerCallEvent[] = [
  owner('How much is pending?'),
  munshi('Haa, one second.'),
  tool('book_summary', 'Total pending: 49,850 rupees from 11 people.', { outstanding: 49850 }),
  munshi('49,850 pending from 11 people. Anything else, Srinivas?'),
  owner('No, bye.'),
  munshi('Bye!', true),
];
