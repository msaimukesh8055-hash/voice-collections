# ADR-0023: LLM calls are traced to Langfuse, hooked once, off without keys

## Status
Accepted (2026-11-23, Saim: interview step 6, "only if time allows"; Langfuse Cloud project created by Saim, EU region). Extends the ops tracing of M9 (trace ids in `ops_events`); does not change ADR-0022's rule that logs carry no text.

## Context
Our ops events show that an LLM call happened, how long it took and what it cost, but never what was asked or answered (by rule: no personal data in logs). When the WhatsApp brain, the follow-up agent, a simulated call or the tone judge gives a wrong answer, we can count it but not read the prompt and answer that produced it. A forward deployed engineer debugging an agent in a client's system needs that view, and Langfuse is the common tool for it.

## Decision
- **One hook.** `_shared/llm/json-llm.ts` gains an optional `observe` callback, called once after every Sarvam or Gemini call ends, whether it worked or threw. Every LLM call our code makes already goes through this file, so nothing else changes. Asha's and Munshi's own model turns run inside Sarvam and are not traced here.
- **OpenTelemetry over plain HTTP, no SDK** (`POST <host>/api/public/otel/v1/traces`, OTLP/HTTP JSON, Basic auth, header `x-langfuse-ingestion-version: 4` so it shows at once). Langfuse switched off its older `/api/public/ingestion` for traces on 2026-11-16; our first live send got 410 Gone and was only a warning, as designed. One span per call, which Langfuse shows as one trace with one generation. The trace id is our own `trace_id` without its dashes (also kept as `ops_trace_id` metadata), so a Langfuse trace and an Ops trace match. The span carries model, prompt version, input, output, tokens, start and end time, cost in ₹ (metadata; Langfuse's own cost field is USD), and ERROR level with the error class on failure.
- **Off unless both keys are set.** `LANGFUSE_HOST` (or `LANGFUSE_BASE_URL`) defaults to Langfuse Cloud EU. Keys are function secrets uploaded by `npm run functions:deploy`.
- **Never in the way.** The send runs after the reply through the function's own `defer` (waitUntil), with a 5 s timeout; a failure is one `langfuse_send_failed` warning with a status code or error class.
- **Redact switch.** `LANGFUSE_REDACT=on` masks numbers (amounts, phone numbers), JSON `name` fields and capitalised Latin words, and sends only the system prompt's length. **Off today**: every name and amount is fake, and readable prompts are the point of the demo.

## Alternatives considered
1) The Langfuse SDK (now built on the OpenTelemetry SDK): a new dependency in five Edge Functions for one HTTP call; its batching also assumes a long-lived process.
2) Store prompts and answers in our own database: no new vendor, but we would be building a trace viewer, and logs would stop being text-free.
3) Hook each caller (brain, follow-up, simulator, judge): four places to keep in step instead of one.

## Consequences
- Prompts and answers leave our systems when tracing is on (threat model, threat 12). Langfuse Cloud has no India region, so a real lender's data needs self-hosted Langfuse in India, or redact on, or no tracing.
- Redaction is best-effort: names in Telugu or Hindi script are not detected, and it over-masks (the first word of a sentence).
- Turning tracing off after a deploy needs `supabase secrets unset`; a blank `.env` value is not uploaded.
- Free plan limits (events per month, history kept) are far above this pilot's use.
