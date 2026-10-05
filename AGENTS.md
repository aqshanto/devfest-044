# AGENTS.md

Instructions for any AI coding agent working in this repo. Same rules as `CLAUDE.md`. Read that first.

- Scope and phases: `plan.md`
- Prompt log for commit messages: `PROMPTS.md`
- Routing logic lives only in `router.js`; UI must call `findRoute()` and never compute paths itself.
- Before the final commit, run `node test.js`. All sample checks must pass.
