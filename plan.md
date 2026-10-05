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
