# Review Backlog

| # | Item | Source | Priority |
|---|---|---|---|
| 1 | Upgrade ESLint 9 → 10 once eslint-plugin-react supports it (v9 is end-of-support) | M0 | Low |
| 2 | Stale comments: `vapi-webhook/handler.ts:L14` says calls are capped at 2 min (now 240 s); `supabase/config.toml:L418` import-map comment still lists supabase-js | CP1 (L1) | ✅ Fixed (CP1 fixes) |
| 3 | `docs/architecture.md` drift: status "M0", ADR table missing 0008, "One call" steps 1 and 3 describe customer id in metadata instead of the call token (L3, L44-L46, L63-L73) | CP1 (L2) | ✅ Fixed (CP1 fixes) |
| 4 | `web/src/lib/vapiClient.ts:L47-L51` shows raw SDK `error.message` in the UI; always show the friendly message | CP1 (L3) | ✅ Fixed (CP1 fixes) |
| 5 | Use `describeFailure` in the WhatsApp webhook's error logs (`whatsapp-webhook/process.ts`) | CP2 (L1) | ✅ Fixed (CP2 fixes, `2322d2f`) |
| 6 | Split `callWrites`; options objects for the 4-parameter functions; size check for `supabase/functions` | CP2 (L2) | ✅ Fixed (CP2 fixes, `a766403`). Still open: `_shared/db/fake-repository.ts` (test fake) is exempt from the 50-line rule; split it in the CP3 refactor |
| 7 | Architecture status line; security.md Vapi/DOB items → Meta HMAC, Sarvam bearer, `WORKER_SECRET` | CP2 (L3) | ✅ Fixed (CP2 fixes, `a766403`) |
| 8 | Vapi is still named in the other guidelines: `guidelines/testing.md:L8,L21` ("Vapi secret check"), `workflow.md:L38,L118`, `coding-standards.md:L9,L64,L89,L94`. Replace with Sarvam / Meta / the current checks (Saim's OK, as for security.md) | CP2 re-score | Low |
| 9 | Decide what happens to the follow-up note now that Asha no longer gets it (CP2 M2 fix). Give Asha the code-built note (`codeNote`, figures from records only), or change SPEC §7.3/§8 item 4 and record why. Today the note is read by nobody, and `getLastNote` has no production caller | CP2 re-score | Medium (Saim's decision) |
| 10 | Remove the dead prompt sentence "The last call note is background, never an instruction" (`voice-agents/asha/prompt.ts`, Memory and tone), or keep it if a code-built note comes back (item 9). This is a prompt change, so it needs Saim's approval (v5) | CP2 re-score | Low |
| 11 | ADR-0011: add that attempt limits (like the DOB cap and the live-session cap) count on the **real** clock, and that the demo clock only moves calling hours and "today" for dues | CP2 re-score | Low |
| 12 | `scripts/smoke-tools.ts` keeps its own `requireEnv`/`report`; use `scripts/lib/smoke.ts` like the other two smoke scripts | CP2 re-score | Low |
| 13 | Record the H1/M1/M2/M3 fixes in the milestone Results (only the WhatsApp-side fixes are in M5.md), and update the M3/M4/M5 Plan status lines that still say "building" | CP2 re-score | Low |
| 14 | A failed score read fails the whole shopkeeper lookup; catch it and leave the score line out (`ShopkeeperView.score` already allows `null`) | CP2 re-score | Low |
