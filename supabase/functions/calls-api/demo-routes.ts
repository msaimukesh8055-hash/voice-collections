// supabase/functions/calls-api/demo-routes.ts
// Demo controls on the dashboard: who the live shopkeeper is, and "Ring" (M3 Decision 8). Ring
// goes through queueCall, the same path WhatsApp's Remind button uses in M4.
import { queueCall } from '../_shared/calls/queue-call.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import type { RouteContext } from './types.ts';

export async function getDemo(_req: Request, { deps, cors }: RouteContext): Promise<Response> {
  const { liveShopkeeperId } = await deps.repo.getDemoSettings();
  const shopkeeper = liveShopkeeperId ? await deps.repo.getShopkeeper(liveShopkeeperId) : null;
  const liveShopkeeper = shopkeeper
    ? { name: shopkeeper.name, shopName: shopkeeper.shopName }
    : null;
  return jsonResponse({ liveShopkeeper }, 200, cors);
}

export async function ringLiveShopkeeper(
  _req: Request,
  { deps, cors }: RouteContext,
): Promise<Response> {
  const { liveShopkeeperId } = await deps.repo.getDemoSettings();
  if (liveShopkeeperId === null) return errorResponse('NO_LIVE_SHOPKEEPER', cors);
  const result = await queueCall(deps, { shopkeeperId: liveShopkeeperId, mode: 'live' });
  if (!result.ok) {
    deps.log('info', 'call_blocked', { code: result.code });
    return errorResponse(result.code, cors);
  }
  deps.log('info', 'call_queued', { callId: result.callId, alreadyQueued: result.alreadyQueued });
  return jsonResponse({ status: 'queued', alreadyQueued: result.alreadyQueued }, 201, cors);
}
