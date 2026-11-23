-- supabase/migrations/20261123000003_wa_exchange_trace.sql
-- Readable traces (Saim, 2026-11-23): each WhatsApp exchange keeps the trace id of the request
-- that handled it, so its report can show what happened step by step (received, AI read it,
-- replies sent) and link the AI step to Langfuse. Additive; older rows stay null.
alter table public.wa_exchanges add column if not exists trace_id uuid;
