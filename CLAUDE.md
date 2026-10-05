# CLAUDE.md

Project: **Smart Escape** — AI DevFest 2026 vibe-coding entry. See `plan.md` for scope, `PROMPTS.md` for the prompt log.

## Hard rules (contest)
- Frontend only. No backend, serverless, or remote DB. localStorage is fine.
- No secrets / API keys in the repo.
- Every commit message: what changed + `Prompt: "<prompt used>"` (or `Manual edit`). Never force-push or rewrite history.
- Commit at least every 30 minutes. Nothing after T+90.
- Never hard-code routes or sample IDs; judges use unseen datasets.
- All UI text goes through `i18n.js` (English + Bangla).

## Code conventions
- Plain ES2020, no build step. Scripts loaded in order: `i18n.js`, `router.js`, `app.js`.
- `router.js` stays pure (no DOM) and exports via `module.exports` when available, so `node test.js` works.
- Keep animations brief (≤300 ms) and respect `prefers-reduced-motion`.

## Commands
- Run locally: `npx serve .` (or open `index.html`; the sample auto-load needs http).
- Test: `node test.js`
