-- supabase/migrations/20261122000003_test_draft_whatsapp_chat.sql
-- ADR-0022: a test draft made from a kept WhatsApp message (the WhatsApp chats page) gets its
-- own source, so the Evals page can link back to that message rather than to an Ops trace.
alter table public.test_drafts drop constraint test_drafts_source_check;
alter table public.test_drafts add constraint test_drafts_source_check
  check (source in ('asha_call', 'munshi_call', 'whatsapp', 'whatsapp_chat'));
