# Smart Escape — Build Plan

Frontend-only evacuation route simulator. Plain HTML/CSS/JS + SVG, no build step, deploy on GitHub Pages.

## Files
| File | Purpose |
|---|---|
| `index.html` | Layout: header, map, side panel |
| `style.css` | Theme, node/edge states, animations |
| `i18n.js` | English + Bangla strings |
| `router.js` | Validation + Dijkstra with tie-breaks (pure, Node-testable) |
| `app.js` | State, rendering, events |
| `building.json` | Sample dataset (auto-loaded as demo) |
| `test.js` | `node test.js` → sample checks from PDF §4.1 |

## Phases (time-boxed)
| # | Time | Work | Commit |
|---|---|---|---|
| 1 | T+15–40 | Docs, validation, router, map render, start select | #1 |
| 2 | T+40–65 | Hazard toggles, reset, failure messages, Bangla/English | #2 |
| 3 | T+65–80 | Animations, tests, screenshots, README | #3 |
| 4 | T+80–90 | Push, deploy, verify live link, submit form | final |

Testing policy: no tests during phases 1–2 (only a quick visual check). All testing in phase 3.

## Routing rules (PDF §3.3)
1. Remove blocked nodes (+ their edges), blocked edges, closed exits.
2. Dijkstra from start; compare `(cost, path)`: lower cost, then lexicographically smaller node-ID sequence.
3. Among reachable open exits: min cost → smallest exit ID.
4. Start blocked → "Starting location blocked". No exit reachable → "No route available".

## Validation (PDF §3.1)
building non-empty · 2–60 nodes · 1–150 edges · unique ids · non-empty label · type ∈ room/junction/exit · numeric x,y · edge from/to exist · no self-loop · no repeated pair · positive integer cost · ≥1 room/junction and ≥1 exit · initial_state arrays exist, IDs exist and match category.

## Sample checks
| Action | Expected |
|---|---|
| Select R1 | R1-C1-C2-E1, 7 |
| R1 + block C2 | R1-C1-C3-C4-E2, 11 |
| R1 + close E1, E2 | No route available |
| Select R2 | R2-C3-C4-E2, 7 |
| R1 then block R1 | Starting location blocked |

## Fixed decisions
- **No backend.** Rulebook §5.1 forbids participant backend/serverless (disqualification). Frontend only.
- **Deploy:** Vercel, static, no build. Framework preset "Other", root `./`, no build command, output `./`. (Render Static Site also works: publish dir `.`, no build command.)
- **Structure (flat, deploy-ready):** `index.html` at root; `screenshots/`, `test.js`, docs at root.
- **Commits:** small commit + push after every finished feature/fix (not just 3). Each message = what changed + `Prompt: "..."`. Never rewrite pushed history.
- **AI budget:** small targeted edits, no rewrites of whole files, short replies.

## Remaining steps (each = 1 commit + push)
1. Push to GitHub + fill name/reg no in README & LICENSE
2. Vercel deploy + live link in README
3. `test.js` (sample checks + tie + invalid input)
4. Screenshots (baseline, C2 blocked)
5. Polish/bonus (PNG export) if time
6. Final README check → submit form
