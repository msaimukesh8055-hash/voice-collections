// supabase/functions/_shared/tools/__fixtures__/tool-context.ts
// Test setup shared by the tool tests: a fake repository holding one call, and its tool context.
import {
  createFakeRepository,
  FAKE_NOW,
  type FakeCall,
  fakeCall,
  type FakeState,
} from '../../db/fake-repository.ts';
import type { Repository } from '../../db/repository.ts';
import type { ToolContext } from '../types.ts';

export interface ToolSetup {
  readonly ctx: ToolContext;
  readonly state: FakeState;
  readonly repo: Repository;
}

export interface ToolSetupOptions {
  readonly call?: Partial<FakeCall>;
  readonly state?: Partial<FakeState>;
  readonly now?: Date;
  /** Replaces repository methods, e.g. to simulate a database failure or a race. */
  readonly repo?: Partial<Repository>;
}

export function toolSetup(options: ToolSetupOptions = {}): ToolSetup {
  const call = fakeCall(options.call);
  const fake = createFakeRepository({ calls: [call], ...options.state });
  const repo: Repository = { ...fake.repo, ...options.repo };
  const { endedAt: _endedAt, durationSeconds: _duration, ...session } = call;
  return { ctx: { repo, session, now: options.now ?? FAKE_NOW }, state: fake.state, repo };
}

/** A context whose shopkeeper already confirmed who they are. */
export function confirmedSetup(options: ToolSetupOptions = {}): ToolSetup {
  return toolSetup({ ...options, call: { identityStatus: 'confirmed', ...options.call } });
}

/** True when a reply text contains a digit (refusals before identity must contain none). */
export function hasDigits(text: string): boolean {
  return /\d/.test(text);
}
