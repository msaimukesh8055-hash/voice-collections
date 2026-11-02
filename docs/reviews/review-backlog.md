# Review Backlog

| # | Item | Source | Priority |
|---|---|---|---|
| 1 | Upgrade ESLint 9 → 10 once eslint-plugin-react supports it (v9 is end-of-support) | M0 | Low |
| 2 | Stale comments: `vapi-webhook/handler.ts:L14` says calls are capped at 2 min (now 240 s); `supabase/config.toml:L418` import-map comment still lists supabase-js | CP1 (L1) | ✅ Fixed (CP1 fixes) |
| 3 | `docs/architecture.md` drift: status "M0", ADR table missing 0008, "One call" steps 1 and 3 describe customer id in metadata instead of the call token (L3, L44-L46, L63-L73) | CP1 (L2) | ✅ Fixed (CP1 fixes) |
| 4 | `web/src/lib/vapiClient.ts:L47-L51` shows raw SDK `error.message` in the UI; always show the friendly message | CP1 (L3) | ✅ Fixed (CP1 fixes) |
