// supabase/functions/_shared/calls/owner-call-limits.ts
// Munshi's owner-call limits (M8, ADR-0018 amendment 5), in one place: the WhatsApp link, the
// calls-api routes and proxy, and munshi-tools all read them from here.

/** A "Call Munshi" link works once, for this long after the tap. */
export const OWNER_CALL_LINK_TTL_MS = 15 * 60_000;
/** At most this many links per window: a stuck finger or a loop cannot fill the table. */
export const MAX_OWNER_LINKS_PER_WINDOW = 3;
export const OWNER_LINK_WINDOW_MS = 10 * 60_000;
/** Budget guard: at most this many Munshi sessions a day, inside the shared daily cap of live
 * sessions (MAX_LIVE_SESSIONS_PER_DAY in calls-api/sarvam-proxy.ts). Real clock, IST midnight. */
export const MAX_MUNSHI_SESSIONS_PER_DAY = 6;
/** Munshi's tools work this long after Start call (Sarvam caps the call at 8 minutes). */
export const OWNER_TOOL_TTL_MS = 10 * 60_000;
