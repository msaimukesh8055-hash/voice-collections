# voice-agents/

The product's voice agents, as code. One folder per agent: `asha/` (shopkeepers' reminder calls) and `munshi/` (the owner's call line, M8).

`asha/` holds the prompt (`prompt.ts`, v1 draft for Saim's review), greetings and recording notice per language (`greetings.ts`), voice, languages, call cap and agent variables (`agent.config.ts`), and the 5 API tools (`tools.ts`, generated from the same Zod schemas `sarvam-tools` validates with). `munshi/` has the same files: prompt v1 (`prompt.ts`), the Telugu greeting (`greetings.ts`), the voice in one constant `MUNSHI_VOICE` (Aayan; change that one line to switch), an 8-minute cap, the `owner_call_token` variable (never sent to the LLM) and the tools generated from `_shared/owner-tools/schemas.ts` (Build A: `book_summary`, `lookup_shopkeeper`, on `/munshi-tools/<tool>`). `tool-fields.ts` turns a Zod argument schema into Sarvam body fields for both agents. `schema.ts` validates the whole config.

## Publishing to Sarvam

Sarvam has no public config API, so the JSON is pushed with the Sarvam MCP connector:

1. `npm run agent:build` → `asha/build/agent.json` (git-ignored; contains the project URL). Tool URLs point at `…/functions/v1/sarvam-tools/<tool>`. For Munshi: `npm run agent:build -- --agent munshi` → `munshi/build/agent.json`, tool URLs on `…/functions/v1/munshi-tools/<tool>`.
2. Create or update the agent from that JSON with the MCP connector.
3. In Sarvam's console, attach the bearer secret to each tool (the connector refuses secrets): `easy-recovery-tool-secret` on Asha's 5 tools, `easy-recovery-owner-tool-secret` on Munshi's (never Asha's secret).
4. Commit a version; put `appId` and `committedVersion` in `<agent>/sarvam-agent.json`; set `SARVAM_APP_ID` (Asha) or `SARVAM_MUNSHI_APP_ID` (Munshi) in `.env` and run `npm run functions:deploy`.
5. `npm run agent:record` (add `-- --agent munshi` for Munshi) writes the `publishes` row (version ↔ config hash).

Not to be confused with `.claude/agents/`, which are the helpers used to *build* this project.
