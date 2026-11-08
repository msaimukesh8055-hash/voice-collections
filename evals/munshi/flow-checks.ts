// evals/munshi/flow-checks.ts
// Scenario-specific checks on how Munshi got there (M8 C1 "must happen"): which tool he used and
// how often, asking which one before saying any figure, what a tool told him, and what he said
// after it. Not critical: they count towards "≥ 14 of 15 scenarios" (outcomes are critical).
import { z } from 'zod';
import { numbersIn } from '../../supabase/functions/_shared/figure-words.ts';
import {
  type Indexed,
  munshiLines,
  offeredChoices,
  ownerEvents,
  toolEvents,
  type ToolEvent,
} from './timeline.ts';
import type { Check, EvalRun } from './types.ts';

export interface ToolUse {
  /** Arguments the call must have (compared as text, so 5000 and "5000" both match). */
  readonly args?: Readonly<Record<string, string | number>>;
  /** Exactly this many calls; at least one when left out. */
  readonly count?: number;
}

const ToolArgs = z.record(z.string(), z.unknown());

function hasArgs(tool: ToolEvent, args: Readonly<Record<string, string | number>>): boolean {
  const given = ToolArgs.safeParse(tool.args).data ?? {};
  return Object.entries(args).every(
    ([key, value]) => String(given[key]).toLowerCase() === String(value).toLowerCase(),
  );
}

/** He used `name` (with these arguments), once or exactly `count` times. */
export function usesTool(name: string, use: ToolUse = {}): Check {
  return {
    id: `uses_${name}`,
    critical: false,
    test(run: EvalRun): string | null {
      const calls = toolEvents(run, name).filter((tool) => hasArgs(tool.event, use.args ?? {}));
      const fits = use.count === undefined ? calls.length > 0 : calls.length === use.count;
      return fits ? null : `${name} called ${calls.length} times (${JSON.stringify(use)})`;
    },
  };
}

/** `name` offered choices, and Munshi said no figure until his next line (he asked which). */
export function asksWhich(name: string): Check {
  return {
    id: `asks_which_${name}`,
    critical: false,
    test(run: EvalRun): string | null {
      const choices = toolEvents(run, name).find((tool) => offeredChoices(tool.event));
      if (!choices) return `${name} never offered choices (a guess?)`;
      const answer = ownerEvents(run).find((owner) => owner.index > choices.index);
      const until = answer?.index ?? Number.POSITIVE_INFINITY;
      const early = munshiLines(run).find(
        (line) =>
          line.index > choices.index && line.index < until && numbersIn(line.event.say).length > 0,
      );
      return early ? 'said a figure before he picked one' : null;
    },
  };
}

/** Some successful `name` reply had `key` = `value` (e.g. the right Suresh's balance). */
export function toolGave(name: string, key: string, value: string | number): Check {
  return {
    id: `${name}_gave_${key}`,
    critical: false,
    test(run: EvalRun): string | null {
      const seen = toolEvents(run, name).some(
        (tool) => tool.event.result.ok && tool.event.result.data[key] === value,
      );
      return seen ? null : `no ${name} reply with ${key} = ${String(value)}`;
    },
  };
}

function lastOf(run: EvalRun, name: string): Indexed<ToolEvent> | undefined {
  return toolEvents(run, name)
    .filter((tool) => tool.event.result.ok)
    .at(-1);
}

/** After the last successful `name`, a Munshi line matches `pattern`. */
export function saysAfter(name: string, pattern: RegExp, id: string): Check {
  return {
    id,
    critical: false,
    test(run: EvalRun): string | null {
      const tool = lastOf(run, name);
      if (!tool) return `no successful ${name}`;
      const said = munshiLines(run).some(
        (line) => line.index > tool.index && pattern.test(line.event.say),
      );
      return said ? null : `nothing matching ${pattern.source} after ${name}`;
    },
  };
}

/** A tool reply carried `note`, and a later Munshi line matches `pattern` (he passed it on). */
export function passesOnNote(note: string, pattern: RegExp, id: string): Check {
  return {
    id,
    critical: false,
    test(run: EvalRun): string | null {
      const carrier = toolEvents(run).find((tool) => tool.event.result.say.includes(note));
      if (!carrier) return 'no tool reply carried the note';
      const said = munshiLines(run).some(
        (line) => line.index > carrier.index && pattern.test(line.event.say),
      );
      return said ? null : 'never told him';
    },
  };
}
