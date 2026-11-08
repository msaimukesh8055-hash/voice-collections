// web/src/test/fixtures.ts
// Shared fake data for web tests (fake persona only).
import type { AcceptedCall, AcceptedMunshiCall } from '../lib/appApi.ts';

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

/** A /munshi link token: "<owner call id>.<43 base64url characters>" (fake signature). */
export const OWNER_CALL_ID = '22222222-2222-4222-8222-222222222222';
export const LINK_TOKEN = `${OWNER_CALL_ID}.${'a'.repeat(43)}`;

export const ACCEPTED_MUNSHI_CALL: AcceptedMunshiCall = {
  ownerCallToken: OWNER_CALL_ID,
  ownerName: 'Srinivas Reddy',
  ownerShortName: 'Srinivas',
  businessName: 'Sri Lakshmi Traders',
  today: 'Saturday, 2026-11-07',
  sarvam: { orgId: 'org', workspaceId: 'ws', appId: 'munshi-app' },
};
