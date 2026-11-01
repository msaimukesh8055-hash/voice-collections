# ADR-0001: Vapi browser web calls, no phone numbers

## Status
Accepted

## Context
The prototype needs real voice (ASR, TTS, interruptions) on an agent platform named in the JD, within a ₹0 budget and without telephony KYC.

## Decision
- Use **Vapi** as the voice platform.
- Calls run in the **browser** via the Vapi Web SDK (WebRTC); no phone numbers.
- Assistant configuration lives as code in `agent/` and is pushed via script.

## Alternatives considered
1) Retell AI (more no-code; similar cost; less control over server-side tools)
2) Browser Web Speech API only (free, but weak Hindi and loses "built on an agent platform")
3) Real phone numbers via Twilio/Exotel (cost + Indian KYC; out of budget and time)

## Consequences
- Free credit covers manual tests and the demo; bulk testing moves to text evals.
- No PSTN realities (voicemail, carrier latency, DLT) are exercised — covered in `docs/go-live.md` (M7).
- Future: swap the browser transport for a SIP/phone number without changing tools or prompts.
