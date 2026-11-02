// supabase/functions/_shared/vapi.ts
// Constants shared by the webhook (Deno) and the assistant push script (Node).

/** Header carrying the shared secret on every request Vapi sends to our server URL. */
export const VAPI_SECRET_HEADER = 'x-vapi-secret';
