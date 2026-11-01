# voice-agents/

The product's voice agents, as code — what borrowers actually talk to. One folder per use case (`collections/` now; `lead-qualification/` if it happens).

Each holds the agent's model, prompt, languages (speech-to-text, voice, greeting), call settings and tools. `npm run agent:push` validates the config (`schema.ts`), converts it to Vapi's format (`vapi-payload.ts`) and publishes it.

Not to be confused with `.claude/agents/`, which are the helpers used to *build* this project.
