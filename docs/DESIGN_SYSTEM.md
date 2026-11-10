# TraderHome design system

Every route keeps its own stylesheet. The build injects three shared files into every page, in this order, after the page's own CSS:

| File | Role |
|---|---|
| `portal/assets/traderhome-tokens.css` | Single source of colours, type scale, radius, spacing, layout widths, and the shared `.th-fresh` freshness badge. |
| `portal/assets/traderhome-shell.css` | Header, grouped navigation, data-status popover, page bar, site footer. |
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

## Page anatomy (every product page, same order)

1. **Shell header** — brand, grouped navigation, data-status button.
2. **Page bar** (`.th-stagebar`, built by `traderhome-shell.js` from the `stages` table) — canonical name, one-line purpose, "输出" and "边界" chips, and the freshness badge with the data day. This is the only place a page states its name and overall freshness; pages do not repeat it with their own kicker or badge.
3. **Page header** — one `h1` at `--th-fs-3xl` and one lead sentence. No landing-page heroes on product pages (the home page keeps its hero).
4. **Content.**
5. **Page note** (`.th-pagenote`) — one short line about this page's data source or privacy. No disclaimer here.
6. **Site footer** (`.th-sitefoot`) — injected by `build_site.py` into the static HTML of every page: disclaimer, 数据状态, 免责声明.

## Editions and notices

Data can be up to date and still not be "today's signal". Two such editions exist today; both are declared by the data, never by hand-written page text.

| Edition | Declared by | Badge | Status line | In the page |
|---|---|---|---|---|
| Research (IncomeOS) | `publicationMode: "research_partial"` in `incomeos-full.json` | `研究版` (`data-state="research"`, info blue) instead of `已更新` | `… · 手动发布 · 不生成订单` | One notice in the page header: `研究版 · 不可执行`, the reason with counts, and where the details are |
| Recalculated (TailTrend) | `revision` in `latest.json` | unchanged (`已更新`) | `… · 事后重算版` | One notice above the table: `事后新版研究重算，非当时信号` |

- `_write_status()` copies the edition into `traderhome-status.json` as `edition` (badge label) and `note` (one phrase for the status line). `TraderHome.chip(m)` and `TraderHome.statusLine(m)` render them on the page bar, the status panel and the home board. A late or stale module keeps its freshness label: being old matters more than the edition.
- **Notice** (`.th-notice`, in `traderhome-unify.css`): a bold title and one sentence. Tones via `data-tone`: default info (an edition), `warn` (partial), `stop` (stale or blocked), `ok`, `quiet`. One notice per page for one fact; the rest of the page refers to it instead of repeating it on every card.
- A page that cannot produce orders must not be titled like an order sheet. Headings, tab names and empty states follow the snapshot (`renderExecutionFraming` in `incomeos-app.mjs`); they switch back by themselves when a verified snapshot is published.
- The labels required by the publication rules stay on the page in every layout: `研究版`, `不可执行`, `仅研究 · 不可执行` on each option row, source times shown as known or `未知`, `事后新版研究重算，非当时信号`. Restyling may move or merge them, never drop them. `portal/test_site_display.mjs` and `portal/test_portal.py` check this.
- The no-JavaScript text of a notice is the cautious reading (`研究展示，不是实时可执行行情`); the script replaces it with the edition actually published.

## Canonical names

Use exactly these in navigation, page bar, `<title>`, home cards, the contracts table and cross-links.

| Key | Name | Sub-brand (small text only) |
|---|---|---|
| `history` | 历史证据 | 刻舟求剑 |
| `review` | 交易复盘 | TradeReview |
| `incomeos` | IncomeOS | 长期资金 |
| `tailtrend` | TailTrend | 尾部与趋势 |
| `otc` | 场外日线 | — |
| `marketSimulation` | 模拟盘 | 六个主流市场 |
| `dailyTrade` | 早晚报 | — |

`<title>` is `<Name> · TraderHome`. Links to another product read `打开 <Name> →`.

## Wording

- Interface text is Chinese. Engine codes stay in the data (`FRESH`, `STALE`, `MISSING`, `LOWER_TAIL_RECLAIMED`…) and are translated at render time (最新 / 过期 / 缺失…). Product names, tickers and standard terms (ATR, IV, Delta, P/C) stay as they are.
- A daily product is dated by its **data day** (`数据日 11-09`), from `dataDate` in the status file — not by a clock time converted to the visitor's zone.
- Never hide missing, stale or partial data to make a page look clean. Say what is old and how old: `比报告早 62 天`, `中间 61 个交易日没有运行`, `中断 48 天`.
- A day that was not run is shown as missing, never as "0 changes" or filled from later data.
- When data is stale, action wording changes: links read `回看上次结果`, action columns read `数据过期，暂不判断`.
- Times carry their clock: market data on the exchange's (`11-09 16:00 美东`), "generated at" on the visitor's (`11-10 13:32`, labelled 你的本地时间 where it matters). No raw ISO strings (`2026-11-10T05:32:21.593Z`) in page text.
- A fact that is the same for every row is said once above the table (`表中 50 只的报价都没有来源时间`); rows carry it only when they differ. Long per-symbol check lists are grouped by problem, with every symbol still listed under its group.
- Comparisons name what they compare with (`与上一份快照（2026-08-12）相比`), not "昨日" or "上一个交易日", because runs can be skipped.
