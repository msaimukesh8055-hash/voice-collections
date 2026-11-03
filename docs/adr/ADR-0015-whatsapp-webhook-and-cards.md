# ADR-0015: WhatsApp webhook with background work, and Save cards for every change

## Status
Accepted (M4, 2026-11-02). Builds on ADR-0013 (WhatsApp first) and ADR-0014 (code first, LLM second).

## Context
The owner runs his credit book from WhatsApp. Meta calls one web address (the webhook) for every message. Meta retries if it does not get a quick 200, and an LLM reply can take seconds. Anyone who learns the address could post fake messages. The owner's phone number is the only real personal data in the project. And the money book must never change because an AI guessed wrong.

## Decision
- **One function, `whatsapp-webhook`**, deployed without Supabase JWT checks (Meta cannot send one). It answers Meta's one-off GET verify check (constant-time token compare) and receives messages by POST.
- **Signature first.** Every POST is checked against `X-Hub-Signature-256` (HMAC-SHA256 of the *raw* bytes with the App Secret, constant-time). Wrong or missing → 401 and nothing is read.
- **200 at once, work in the background** (`EdgeRuntime.waitUntil`). Slow LLM answers never cause Meta retries.
- **Handle once.** Each Meta message id is inserted into `wa_messages` with a unique rule; a retry hits the rule and stops.
- **Owner only.** The sender is compared (constant time) with `OWNER_WHATSAPP_NUMBER`, a function secret. Rows store only a keyed hash (HMAC with the App Secret), never the number or the message text. A stranger gets one "not registered" reply a day, enforced by a unique index; nothing else is read or written.
- **Every change is a card.** Add credit and mark paid create a `pending_actions` row (30-minute expiry) and send [Save] [Edit] [Cancel]. Button ids carry only the card id. Each tap moves the card out of `open` with a compare-and-set, so a double tap cannot save twice. Unclear names get a pick list; new names get "Add as a new shopkeeper?". Payment claims from Asha are settled with [Confirm received] [Not received] by a compare-and-set on the claimed entry.
- **The LLM only suggests** one Zod-checked JSON object; it never reaches a write. Sarvam `sarvam-105b` first (reasoning off), Gemini 2.5 Flash on failure, then "Sorry" + help. Which path answered is stored per message.

## Alternatives considered
1) Answer Meta after the work is done: simpler, but LLM latency causes retries and duplicate replies.
2) Save straight away and offer Undo: fewer taps, but a wrong guess changes a balance, even if briefly.
3) Store the owner's number in `owners.whatsapp_number`: easier lookup, but puts real personal data in the database and backups.
4) Let the LLM call tools in a loop: more flexible, but slower, costlier and harder to test (ADR-0014).

## Consequences
- Replies arrive a moment after the 200; errors in the background are only visible in function logs.
- Every change costs the owner one extra tap; in return the ledger only changes on his tap.
- Rotating the App Secret changes every sender hash (old rows stop matching; harmless for this prototype).
- The deployed function needs 8 more secrets (`META_*`, `WHATSAPP_VERIFY_TOKEN`, `OWNER_WHATSAPP_NUMBER`, `SARVAM_API_KEY`, `GEMINI_API_KEY`).
