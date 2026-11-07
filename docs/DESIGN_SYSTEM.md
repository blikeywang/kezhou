# TraderHome design system

Every route keeps its own stylesheet. The build injects three shared files into every page, in this order, after the page's own CSS:

| File | Role |
|---|---|
| `portal/assets/traderhome-tokens.css` | Single source of colours, type scale, radius, spacing, layout widths, and the shared `.th-fresh` freshness badge. |
| `portal/assets/traderhome-shell.css` | Header, grouped navigation, data-status popover, slim stage bar. |
| `portal/assets/traderhome-unify.css` | Maps each product's local variables (`--rv-*`, `--io-*`, `--tt-*`, `--ms-*`, OTC and Kezhou variables) onto the tokens, plus a few shared component rules. |

`build_site.py` also stamps `<html data-th-stage="…">` at build time so the right accent applies on first paint.

## Rules

- **Surfaces** step up in lightness: `--th-bg` → `--th-surface-1` → `--th-surface-2` → `--th-surface-3`.
- **One accent per product** (`--th-accent`, chosen from `data-th-stage`). Use it for nav markers, eyebrows, active tabs and primary buttons only.
- **Semantic colours** (`--th-up`, `--th-down`, `--th-warn`, `--th-info`) never change per product and always come with a text label.
- **Text floor:** 12px for anything with Chinese text. 11px is allowed only for uppercase mono labels (kickers, step numbers, badges).
- **Freshness is judged against the visitor's clock**, never baked into a snapshot. `assets/traderhome-status.json` lists each product's data time and cadence; `window.TraderHome.freshness(asOf, policy)` returns `fresh` / `late` / `stale`. A stale product shows a red badge and must not present signals as current.
- **One sticky bar.** Product toolbars that need to stick sit at `top: var(--th-shell-h)`.
- **Owner-only tools stay quiet for visitors.** The personal data hub is probed only after `?hub=1`, an existing hub token, or a click on a hub button.

## Adding or restyling a product

1. Use local variables in the product CSS as before.
2. In `traderhome-unify.css`, map those variables to tokens under `html[data-th-stage="<key>"]`.
3. Add the product to `STAGES` in `build_site.py`, to `links`/`groups` in `traderhome-shell.js`, to `--th-accent-<key>` in the tokens, and give it an entry in `_write_status()` with its data time and expected cadence.
