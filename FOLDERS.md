# What each folder is for

A plain-English map of this project, for Saim.

| Folder | What it's for |
|---|---|
| `.claude/` | Instructions for Claude, the builder. The "agents" inside (architect, tester, reviewer and so on) are helpers Claude uses while **building** the project. They are not part of the product. |
| `docs/` | Everything written about the project: what we're building (`SPEC.md`), how it fits together (`architecture.md`), why we chose things (`adr/`), the diary of every step (`BUILD-LOG.md`), each milestone's plan and results (`milestones/`), and code reviews (`reviews/`). |
| `guidelines/` | The rules every piece of work must follow: how code should look, how it's tested, security rules, and the step-by-step workflow with your approval points. |
| `scripts/` | Small helper programs run from the terminal: publish Asha to Vapi, set up the database, and check that no secret keys leaked into the website. |
| `supabase/` | The back end. The database (tables and fake borrower data) plus the server code that runs when Asha uses a tool, such as checking a date of birth or logging a promise to pay. |
| `voice-agents/` | **The product:** Asha's settings as code, meaning her AI model, prompt, languages, voice, greeting and tools. `npm run agent:push` publishes these to Vapi. |
| `web/` | The website you open in the browser: today the test-call page; later the full dashboard (KPIs, calls, follow-ups, call screen). |
| `knowledge/` | *(Filled in M3)* Suvidha Finance's fake policy documents (fees, repayment rules, FAQ). Asha searches these to answer policy questions instead of making things up. |
| `evals/` | *(Filled in M6)* Automated test conversations: an AI plays the borrower, another AI scores Asha. Includes the "release gate" that blocks publishing a worse version. |
| `coverage/` | Created automatically when tests run; shows how much of the code the tests check. Not saved to git. You can ignore it. |

## Files at the top level

| File | What it's for |
|---|---|
| `CLAUDE.md` | Your rules for Claude on this project (plan first, light-blue theme, never commit without asking, and so on). |
| `README.md` | Front page of the project on GitHub: what it is and how to run it. |
| `FOLDERS.md` | This guide. |
| `.env` | Your secret keys. **Never shared, never committed to git.** |
| `.env.example` | The list of key names with empty values, so others know what to fill in. Safe to share. |
| `package.json` | The list of tools the project uses, plus shortcut commands like `npm run check`. |
| Other dot-files (`.gitignore`, `.prettierrc`, `.gitattributes` …) | Settings for git and the code-formatting tools. You can ignore them. |
