// supabase/functions/calls-api/__fixtures__/munshi.ts
// Munshi deps for calls-api tests (M8): the fake owner calls, a fixed link secret, the fake owner.
import { FAKE_OWNER } from '../../_shared/db/fake-book-repository.ts';
import {
  createFakeOwnerCallRepository,
  type FakeOwnerCallState,
} from '../../_shared/db/fake-owner-call-repository.ts';
import type { MunshiDeps } from '../types.ts';

export const MUNSHI_LINK_SECRET = 'munshi-link-test-secret-of-32-chars!!';

export interface MunshiSetup {
  readonly munshi: MunshiDeps;
  readonly state: FakeOwnerCallState;
}

export function munshiSetup(
  options: { ownerCalls?: Partial<FakeOwnerCallState>; linkSecret?: string | null } = {},
): MunshiSetup {
  const fake = createFakeOwnerCallRepository(options.ownerCalls);
  const munshi: MunshiDeps = {
    ownerCalls: fake.ownerCalls,
    linkSecret: options.linkSecret === undefined ? MUNSHI_LINK_SECRET : options.linkSecret,
    getOwner: () => Promise.resolve(FAKE_OWNER),
  };
  return { munshi, state: fake.state };
}
