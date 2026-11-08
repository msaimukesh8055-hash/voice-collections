// supabase/functions/_shared/auth/owner-call-token.ts
// The shape of Munshi's link token and the page path (M8), with no imports so the web app can use
// them too: the /munshi page checks the shape before sending a token anywhere. Signing and
// checking the signature stay server-side (owner-call-link.ts).

export const MUNSHI_PATH = '/munshi';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** "<uuid>.<43 base64url characters>", nothing before or after. */
export const OWNER_CALL_TOKEN_PATTERN = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`);
