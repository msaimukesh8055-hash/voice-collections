# ADR-0022: WhatsApp messages are scored like calls; their text is kept for 30 days

## Status
Accepted (2026-11-22, Saim: "page for whatsapp bot check live evals – ok"; "Yes, 30 days"). Changes part of ADR-0015 / M4 Decision 6 ("no message text stored"). Builds on ADR-0021.

## Context
Asha's and Munshi's live calls are scored and roll up into Agent health (ADR-0021). The WhatsApp owner bot handles more traffic than both, but it kept only the message type, how it was understood and the command, never the words. So a misread message could be counted but not explained, and it could not become a test case without the owner retyping it. On the same day two other gaps showed up in Agent health: the Munshi "WhatsApp only when he asked" check missed Telugu-script requests, and a latency smoke script's owner calls were scored as real calls.

## Decision
- **One exchange per owner message** (`wa_exchanges`): what he sent (typed text, what Saaras heard, or the button title), the bot's reply text, how it was understood (code, Sarvam, Gemini, failed), the command, the card it showed or the card a tap answered, ledger changes made while handling it, reply time, replies Meta accepted or refused, error code, `is_test` for smoke-script messages. Written by the webhook after the replies go out; a failed write is logged and changes nothing for the owner. Strangers never get a row.
- **Text kept 30 days.** A daily pg_cron job deletes older rows. Phone numbers are still never stored. Ops logs and traces still carry no text (security rule unchanged for logs).
- **Scored in code on every read, ₹0, nothing kept**: Guardrails (money moved only on a button tap; no money card from a message it did not understand), Outcome (understood, card answered, voice note got a voice reply, every reply delivered), Latency (3 s text, 8 s voice), Cost (estimate from the M6 price table). Same verdict rule as the call scorecards.
- **Screens:** "WhatsApp chats" in the Agent ops menu (list, one message's report with "Add as a test case" pre-filled); a third Agent health card, "WhatsApp bot", in messages, linking to the messages behind each count.
- **Test calls flagged, not guessed:** `owner_calls.is_test`, set by `smoke:munshi-latency`; the three script calls made before the flag were marked by id. Agent health counts only real, finished calls (and Asha's live ones), even when a score was kept for another call.
- **Munshi's WhatsApp check** also hears Telugu and Hindi script (వాట్సాప్, the Telugu root పంప, व्हाट्सऐप).

## Alternatives considered
1) Keep no text (only command, card result, timings): safe, but "misread" could not be explained or turned into a test.
2) Keep text forever: simplest, but no reason to; a stated limit is what a real pilot would need.
3) Score with an AI judge: slower, costs money, and most replies are fixed wording in code.

## Consequences
- Two additive migrations (`20261122000001_test_owner_calls`, `20261122000002_wa_exchanges`), service role only.
- With `DASHBOARD_PUBLIC` on, the kept message text is readable by anyone with the web address, like the call transcripts already are. All data is fake; before a real trader, the public switch goes (threat model, "Before any real trader's data").
- Costs on the page are estimates, not token counts.
- Messages from before 2026-11-22 have no exchange row and are not scored.
