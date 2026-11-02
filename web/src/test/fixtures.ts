// web/src/test/fixtures.ts
// Shared fake data for web tests (fake persona only).
import type { AcceptedCall } from '../lib/appApi.ts';

export const TOKEN = '11111111-1111-4111-8111-111111111111';

export const ACCEPTED_CALL: AcceptedCall = {
  callToken: TOKEN,
  language: 'te',
  shopkeeperName: 'Ramesh',
  shopName: 'Ramesh Kirana',
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  today: 'Monday, 2026-11-02',
  sarvam: { orgId: 'org', workspaceId: 'ws', appId: 'app' },
};
