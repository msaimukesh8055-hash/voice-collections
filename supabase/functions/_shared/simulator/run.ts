// supabase/functions/_shared/simulator/run.ts
// One simulated call, in one background run of the follow-up worker (M5 Decision 6):
//   end stale simulated calls (their run died) → claim the oldest queued one, only while fewer
//   than 4 run (database lock) → Asha (approved prompt v3 + text mode, sarvam-105b) talks to the
//   shopkeeper (persona prompt, Gemini; Sarvam if Gemini fails) for up to 10 turns, every tool
//   through the same registry, identity guard and audit rows as a live call → the transcript is
//   saved and the call queued for the same follow-up as a live call → the next queued call starts.
// Logs carry ids, counts and outcomes only: never the conversation, names or amounts.
import { findBannedWords } from '../../../../voice-agents/asha/banned-words.ts';
import { istDate, istDayLabel, resolveNow } from '../clock.ts';
import { MAX_SIMULATED_AT_ONCE, simulationStaleBefore } from '../calls/queue.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { CallSession, Repository, Shopkeeper } from '../db/repository.ts';
import { formatInr } from '../format.ts';
import { computeDues } from '../ledger/dues.ts';
import type { ChatRequest, ChatTool } from '../llm/json-llm.ts';
import type { Logger } from '../log.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { auditToolRun } from '../tools/audit.ts';
import { describeFailure, isToolName, runTool } from '../tools/registry.ts';
import type { ToolResult } from '../tools/types.ts';
import { ASHA_SIMULATED_VERSION, ashaGreeting, ashaSystemPrompt, ashaTools } from './asha-text.ts';
import { type ChatFn, type Conversation, converse } from './conversation.ts';
import { buildPersonaPrompt, PERSONA_PROMPT_VERSION } from './persona-prompt.ts';

const ASHA_TEMPERATURE = 0.3;
const SHOPKEEPER_TEMPERATURE = 0.8;
const MAX_REPLY_TOKENS = 400;
const UNKNOWN_TOOL_LABEL = 'unknown';

export interface ChatProvider {
  readonly name: 'sarvam' | 'gemini';
  readonly ask: (request: ChatRequest) => Promise<string>;
}

export interface SimulatorDeps {
  readonly repo: Repository;
  readonly store: ReminderRepository;
  /** Asha is always Sarvam (the product being shown); the shopkeeper tries these in order. */
  readonly asha: ChatProvider;
  readonly shopkeeper: readonly ChatProvider[];
  readonly clock: () => Date;
  readonly log: Logger;
  readonly kickFollowup: (callId: string) => void;
  /** Wakes the worker to start the next queued simulated call (one background run each). */
  readonly startNext: () => void;
}

export type SimulationOutcome = 'done' | 'idle' | 'not_found' | 'failed';

function chatFn(
  providers: readonly ChatProvider[],
  prompt: { side: string; system: string; temperature: number; tools?: readonly ChatTool[] },
  log: Logger,
): ChatFn {
  return async function ask(messages): Promise<string | null> {
    const request = { ...prompt, messages, maxTokens: MAX_REPLY_TOKENS };
    for (const provider of providers) {
      try {
        return await provider.ask(request);
      } catch (error) {
        const fields = {
          side: prompt.side,
          provider: provider.name,
          error: describeFailure(error),
        };
        log('warn', 'simulator_llm_failed', fields);
      }
    }
    return null;
  };
}

function toolRunner(
  first: CallSession,
  deps: SimulatorDeps,
  now: Date,
): (name: string, args: unknown) => Promise<ToolResult> {
  let session = first;
  return async function runSimulatedTool(name, args): Promise<ToolResult> {
    const started = Date.now();
    const run = await runTool(name, args, { repo: deps.repo, session, now });
    if (run.session) session = run.session;
    const tool = isToolName(name) ? name : UNKNOWN_TOOL_LABEL;
    const durationMs = Date.now() - started;
    await auditToolRun({ callId: first.callId, tool, run, durationMs }, deps);
    deps.log(run.failure ? 'error' : 'info', 'tool_call', {
      callId: first.callId,
      tool,
      simulated: true,
      ok: run.result.ok,
      error: run.failure ?? null,
    });
    return run.result;
  };
}

/** Threat words in Asha's lines (SPEC §7.4); counted for the logs, judged by M7's evals. */
export function countBannedWords(transcript: readonly Turn[]): number {
  const ashaText = transcript.filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.content).join(' ');
  return findBannedWords(ashaText).length;
}

interface CallSetup {
  readonly session: CallSession;
  readonly shopkeeper: Shopkeeper;
  readonly persona: string | null;
  readonly demoNow: Date;
  readonly dues: ReturnType<typeof computeDues>;
}

async function loadSetup(callId: string, deps: SimulatorDeps): Promise<CallSetup | null> {
  const [session, settings] = await Promise.all([
    deps.repo.getCallSession(callId),
    deps.repo.getDemoSettings(),
  ]);
  if (!session) return null;
  const [shopkeeper, persona, ledger] = await Promise.all([
    deps.repo.getShopkeeper(session.shopkeeperId),
    deps.store.getPersona(session.shopkeeperId),
    deps.repo.getLedger(session.shopkeeperId),
  ]);
  if (!shopkeeper) return null;
  const demoNow = resolveNow(settings.demoClock, deps.clock());
  const dues = computeDues(ledger, istDate(demoNow));
  return { session, shopkeeper, persona, demoNow, dues };
}

function talk(setup: CallSetup, deps: SimulatorDeps): Promise<Conversation> {
  const { shopkeeper, session } = setup;
  const variables = {
    shopkeeperName: shopkeeper.name,
    shopName: shopkeeper.shopName,
    ownerName: shopkeeper.ownerName,
    businessName: shopkeeper.businessName,
    today: istDayLabel(setup.demoNow),
  };
  const personaSystem = buildPersonaPrompt({
    ...variables,
    persona: setup.persona,
    language: session.language,
    outstanding: formatInr(setup.dues.outstanding),
    overdue: formatInr(setup.dues.overdueAmount),
    daysOverdue: setup.dues.daysOverdue,
  });
  const ashaSystem = ashaSystemPrompt(variables);
  return converse(ashaGreeting(session.language, variables), {
    asha: chatFn(
      [deps.asha],
      { side: 'asha', system: ashaSystem, temperature: ASHA_TEMPERATURE, tools: ashaTools() },
      deps.log,
    ),
    shopkeeper: chatFn(deps.shopkeeper, {
      side: 'shopkeeper',
      system: personaSystem,
      temperature: SHOPKEEPER_TEMPERATURE,
    }, deps.log),
    runTool: toolRunner(session, deps, setup.demoNow),
  });
}

/** Runs one claimed simulated call to its end. */
export async function simulateCall(
  callId: string,
  deps: SimulatorDeps,
): Promise<SimulationOutcome> {
  const started = deps.clock();
  const setup = await loadSetup(callId, deps);
  if (!setup) {
    deps.log('error', 'simulated_call_not_found', { callId });
    return 'not_found';
  }
  const conversation = await talk(setup, deps);
  const endedAt = deps.clock();
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - started.getTime()) / 1000));
  const end = { transcript: conversation.transcript, endedAt, durationSeconds };
  const finished = await deps.store.finishSimulatedCall(callId, end);
  if (finished) deps.kickFollowup(callId);
  deps.log('info', 'simulated_call', {
    callId,
    end: conversation.end,
    turns: conversation.transcript.length,
    toolCalls: conversation.toolCalls,
    bannedWords: countBannedWords(conversation.transcript),
    finished,
    asha: ASHA_SIMULATED_VERSION,
    persona: PERSONA_PROMPT_VERSION,
  });
  return 'done';
}

/** Ends stale simulated calls, then starts the next queued one if a slot is free. */
export async function runNextSimulation(deps: SimulatorDeps): Promise<SimulationOutcome> {
  const now = deps.clock();
  const staleBefore = simulationStaleBefore(now);
  const stale = await deps.store.endStaleSimulatedCalls(staleBefore, now);
  stale.forEach((callId) => {
    deps.log('warn', 'simulated_call_stale', { callId });
    deps.kickFollowup(callId);
  });
  const callId = await deps.store.claimSimulatedCall(MAX_SIMULATED_AT_ONCE, staleBefore);
  if (!callId) return 'idle';
  try {
    return await simulateCall(callId, deps);
  } catch (error) {
    // The call stays in progress; after 5 minutes a sweep ends it and its follow-up runs from
    // the tool events alone.
    deps.log('error', 'simulated_call_failed', { callId, error: describeFailure(error) });
    return 'failed';
  } finally {
    deps.startNext();
  }
}
