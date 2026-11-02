# voice-agents/

The product's voice agents, as code — what shopkeepers actually talk to. One folder per agent (`asha/` now).

`asha/` holds the prompt (`prompt.ts`, v1 draft for Saim's review), greetings and recording notice per language (`greetings.ts`), voice, languages, call cap and agent variables (`agent.config.ts`), and the 5 API tools (`tools.ts`, generated from the same Zod schemas `sarvam-tools` validates with). `schema.ts` validates the whole config.

## Publishing to Sarvam

Sarvam has no public config API, so the JSON is pushed with the Sarvam MCP connector:

1. `npm run agent:build` → `asha/build/agent.json` (git-ignored; contains the project URL). Tool URLs point at `…/functions/v1/sarvam-tools/<tool>`.
2. Create or update the agent from that JSON with the MCP connector.
3. In Sarvam's console, attach the bearer secret `easy-recovery-tool-secret` to each of the 5 tools (the connector refuses secrets).
4. Commit a version; put `appId` and `committedVersion` in `asha/sarvam-agent.json`; set `SARVAM_APP_ID` in `.env` and run `npm run functions:deploy`.
5. `npm run agent:record` writes the `publishes` row (version ↔ config hash).

Not to be confused with `.claude/agents/`, which are the helpers used to *build* this project.
