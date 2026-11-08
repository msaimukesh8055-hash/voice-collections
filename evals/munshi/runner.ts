// evals/munshi/runner.ts
// Runs Munshi's text eval scenarios (M8 C1), one after another: a fresh fake book → Munshi
// (approved prompt v1 + text mode, his 10 tools declared natively) talks to the simulated owner
// for up to 12 owner lines → every tool runs in-process through the SAME owner-tools registry as
// munshi-tools, with the same wrap-up note → code checks → judge. Nothing is written to any
// database and nothing is sent. Munshi's prompt size is metered per scenario so the cost of a
// live run can be checked afterwards.
import { istDayLabel } from '../../supabase/functions/_shared/clock.ts';
import { FAKE_OWNER } from '../../supabase/functions/_shared/db/fake-book-repository.ts';
import type { Logger } from '../../supabase/functions/_shared/log.ts';
import { runOwnerTool } from '../../supabase/functions/_shared/owner-tools/registry.ts';
import { withWrapUp } from '../../supabase/functions/_shared/owner-tools/wrap-up.ts';
import type { Turn } from '../../supabase/functions/_shared/sarvam-analytics.ts';
import {
  munshiGreeting,
  munshiSystemPrompt,
  munshiTools,
  type MunshiVariables,
} from '../../supabase/functions/_shared/simulator/munshi-text.ts';
import {
  converseOwner,
  type OwnerEndReason,
} from '../../supabase/functions/_shared/simulator/owner-conversation.ts';
import { buildOwnerPersonaPrompt } from '../../supabase/functions/_shared/simulator/owner-persona.ts';
import { type ChatProvider, chatFn } from '../../supabase/functions/_shared/simulator/run.ts';
import type { ToolResult } from '../../supabase/functions/_shared/tools/types.ts';
import { createEvalBook, EVAL_START, type EvalBook } from './book.fixture.ts';
import { checksFor, runChecks } from './checks.ts';
import { judgeConversation, type JudgeScores } from './judge.ts';
import type { EvalModels } from './llms.ts';
import type { BookSnapshot, CheckResult, EvalRun, MunshiScenario } from './types.ts';

const MUNSHI_TEMPERATURE = 0.3;
const OWNER_TEMPERATURE = 0.8;

export const EVAL_VARIABLES: MunshiVariables = {
  ownerShortName: FAKE_OWNER.name.split(' ')[0] ?? FAKE_OWNER.name,
  ownerName: FAKE_OWNER.name,
  businessName: FAKE_OWNER.businessName,
  today: istDayLabel(EVAL_START),
};

export interface ToolCallSummary {
  readonly name: string;
  readonly args: unknown;
  readonly ok: boolean;
  readonly code: string | null;
}

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly language: MunshiScenario['language'];
  readonly end: OwnerEndReason;
  readonly checks: readonly CheckResult[];
  readonly judge: JudgeScores | null;
  readonly transcript: readonly Turn[];
  readonly tools: readonly ToolCallSummary[];
  /** Munshi model calls and their prompt size (system, messages and declared tools), for the
   * cost estimate. */
  readonly munshiCalls: number;
  readonly munshiPromptChars: number;
}

interface Meter {
  calls: number;
  chars: number;
}

function metered(provider: ChatProvider, meter: Meter): ChatProvider {
  return {
    name: provider.name,
    ask(request): Promise<string> {
      meter.calls += 1;
      const messages = request.messages.reduce((sum, message) => sum + message.content.length, 0);
      const tools = request.tools ? JSON.stringify(request.tools).length : 0;
      meter.chars += request.system.length + messages + tools;
      return provider.ask(request);
    },
  };
}

function snapshotOf(book: EvalBook): BookSnapshot {
  const { state } = book;
  return {
    entries: state.book.entries,
    reversals: state.book.reversals.map((reversal) => reversal.entryId),
    queued: [...state.queued],
    kicked: [...state.kicked],
    actions: state.actions.actions,
  };
}

/** One tool call exactly as munshi-tools runs it: registry, then the wrap-up note. */
function evalToolRunner(
  book: EvalBook,
): (name: string, args: unknown, realNow: Date) => Promise<ToolResult<string>> {
  return async function runEvalTool(name, args, realNow): Promise<ToolResult<string>> {
    const ctx = book.contextAt(realNow);
    const run = await runOwnerTool(name, args, ctx);
    return withWrapUp(run.result, ctx.ownerCall.acceptedAt, realNow);
  };
}

function toolSummaries(run: EvalRun): readonly ToolCallSummary[] {
  return run.conversation.events.flatMap((event) =>
    event.kind === 'tool'
      ? [
          {
            name: event.name,
            args: event.args,
            ok: event.result.ok,
            code: event.result.ok ? null : event.result.code,
          },
        ]
      : [],
  );
}

async function talk(
  scenario: MunshiScenario,
  models: EvalModels,
  deps: { book: EvalBook; meter: Meter; log: Logger },
): Promise<EvalRun> {
  const before = snapshotOf(deps.book);
  const munshiSystem = munshiSystemPrompt(EVAL_VARIABLES);
  const ownerSystem = buildOwnerPersonaPrompt({ language: scenario.language, ...scenario.owner });
  const munshi = metered(models.munshi, deps.meter);
  const conversation = await converseOwner(munshiGreeting(EVAL_VARIABLES), {
    munshi: chatFn(
      // Tried twice: one timeout or HTTP error is the network, not Munshi's behaviour.
      [munshi, munshi],
      {
        side: 'munshi',
        system: munshiSystem,
        temperature: MUNSHI_TEMPERATURE,
        tools: munshiTools(),
      },
      deps.log,
    ),
    owner: chatFn(
      models.owner,
      { side: 'owner', system: ownerSystem, temperature: OWNER_TEMPERATURE },
      deps.log,
    ),
    runTool: evalToolRunner(deps.book),
    startAt: EVAL_START,
  });
  const secrets = [deps.book.contextAt(EVAL_START).ownerCall.id];
  return {
    language: scenario.language,
    today: EVAL_VARIABLES.today,
    secrets,
    conversation,
    before,
    after: snapshotOf(deps.book),
  };
}

export async function runScenario(
  scenario: MunshiScenario,
  models: EvalModels,
  log: Logger,
): Promise<ScenarioResult> {
  const book = createEvalBook(
    scenario.acceptedAgoMs === undefined ? {} : { acceptedAgoMs: scenario.acceptedAgoMs },
  );
  const meter: Meter = { calls: 0, chars: 0 };
  const run = await talk(scenario, models, { book, meter, log });
  const { transcript, end } = run.conversation;
  const judge = await judgeConversation(
    models.judge,
    { language: scenario.language, transcript },
    log,
  );
  return {
    id: scenario.id,
    title: scenario.title,
    language: scenario.language,
    end,
    checks: runChecks(checksFor(scenario), run),
    judge,
    transcript,
    tools: toolSummaries(run),
    munshiCalls: meter.calls,
    munshiPromptChars: meter.chars,
  };
}

export interface RunOptions {
  readonly modelsFor: (scenario: MunshiScenario) => EvalModels;
  readonly log: Logger;
  /** Called after each scenario (progress lines). */
  readonly onResult?: (result: ScenarioResult) => void;
}

/** Scenarios one at a time (Gemini's free tier and the budget both want it slow). */
export async function runEvals(
  scenarios: readonly MunshiScenario[],
  options: RunOptions,
): Promise<readonly ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const result = await runScenario(scenario, options.modelsFor(scenario), options.log);
    options.onResult?.(result);
    results.push(result);
  }
  return results;
}
