# ADR-0017: Voice notes, live Sarvam Translate, and the signed dashboard link

## Status
Accepted (M6, 2026-11-04). Builds on ADR-0014 (code-first brain), ADR-0015 (webhook, cards) and ADR-0013 (WhatsApp first, dashboard second). Wording (voice lines, spoken versions, insights text) is a draft until Saim approves it; the Saaras mode, Translate style and Bulbul voice are settled by the voice spike.

## Context
The owner should be able to talk to the bot, hear it back, and show a pitch audience what a Telugu conversation says. The bot already understands typed Telugu, Hindi and English through one path. WhatsApp voice notes are Ogg/Opus. Sarvam's quick speech-to-text API accepts Opus as it is and is meant for audio under 30 seconds. Bulbul cannot produce Opus on its current models, and Sarvam Translate has no "keep this word" option. The browser holds only the public Supabase key, and every table is closed to it.

## Decision
- **Voice in = text after one step.** A voice note is downloaded from Meta (1 MB max), its length read from the Ogg file (30 s max), counted against a daily cap (50), then sent to Saaras. The transcript goes through exactly the same brain as typed text; the reply language is the one Saaras detected; the reply starts with "🎤 Heard: …". Every refusal happens before Saaras is paid. Audio and transcript are never stored.
- **Voice out is best effort.** After a heard voice note the text reply goes first, then a short spoken version (no formatting, rupees read out, lists cut to 3 rows) as a Bulbul MP3 audio message. Any failure leaves just the text. Cap 50 a day.
- **Translate live, only where text can't be written in advance.** Fixed bot lines stay hand-drafted. Sarvam Translate makes (a) the English under every Telugu message when the owner's demo setting is on, by wrapping the WhatsApp sender, and (b) the English of a call's Telugu/Hindi transcript on the dashboard, made once and kept on the call. Names and figures are swapped for markers (⟦1⟧…) before sending and put back after; a translation that loses a marker is thrown away. Translate failing never blocks a message or a page.
- **Insights in code, chart drawn in code.** The figures use the same oldest-credit-first rule as the dues. The ring chart PNG is drawn by our own code (no outside service, SPEC D3), uploaded to Meta per message, never stored.
- **Dashboard behind a signed 24-hour link.** The bot sends `<DASHBOARD_URL>/#t=<expiry>.<HMAC>` signed with `DASHBOARD_LINK_SECRET`. The page keeps it for the tab only and sends it as `x-dashboard-token`; calls-api checks it in constant time before reading anything, and answers 401 with no data otherwise. The routes are read-only apart from the one demo switch.

## Alternatives considered
1) Translate every fixed bot line ahead of time with a script: one Sarvam use story, but a second draft of lines that already exist, and slots in every message (Saim chose live translation instead).
2) Build each Telugu message twice (Telugu and English) from our own tables: free and exact, but every message builder would have to change (~2 h).
3) Convert Bulbul's output to Opus in the function for a real voice-note bubble: nicer look, but an audio encoder in the Edge runtime is untested here; MP3 plays fine.
4) Draw the chart with an SVG renderer (WebAssembly) for labels inside the image: prettier, but can't be checked on Supabase's runtime from the build environment; the caption carries the labels instead.
5) An open dashboard with no token: simpler, but anyone with the address would see the book.

## Consequences
- New secrets: `DASHBOARD_LINK_SECRET` (calls-api, webhook), `DASHBOARD_URL` (webhook). `SARVAM_API_KEY` is now also read by calls-api (transcript English).
- New columns: `owners.english_under_telugu`, `calls.transcript_en`.
- Per-message Sarvam cost appears for the English twin (≈ ₹0.5–1 per Telugu message, demo setting only) and for each voice round trip (≈ ₹0.6–1).
- The link points to the laptop's dev server until the Vercel deploy (M8).
