# TraderHome Product System

## 1. North star

TraderHome is one evidence-led trading workflow with three bounded workspaces:

1. **Kezhou / Research** — turn current market shape into a falsifiable historical hypothesis.
2. **EV Desk / Plan** — turn a directional hypothesis into a conditional plan with invalidation and risk.
3. **TradeReview OS / Growth** — turn completed execution into evidence review, a coach redo, a measurable growth stage, and an owner-controlled consultation case.

The product should reduce unstructured action, not increase the number of signals a user consumes.

**NQ Flow Console / Live Flow is deliberately outside this three-stage workflow.** It is an independent intraday observation and execution-authority system for NQ/MNQ order flow plus the Fibo OTE v1.6.4 Bridge. It must not silently alter Kezhou statistics, EV Desk gates, or TradeReview diagnoses.

**IncomeOS is also deliberately outside the three-stage workflow.** It converts variable weekly cash entering IBKR into a browser-local allocation plan, then evaluates growth cycles and cash-secured-put candidates. It cannot write to the broker, consume margin, or turn a stale/static option quote into an executable order.

**TailTrend Lab is also deliberately outside the three-stage workflow.** It maps forward-adjusted regular-session daily candles into mutually exclusive tail, middle, breakout, failure, breakdown and event states. It is a shadow-test scanner and browser-local position-sizing aid, not a fourth vote inside EV Desk and not an order service.

## 2. Product contracts

| Workspace | Input | Output | Reject / downgrade when |
|---|---|---|---|
| Kezhou | Closed historical candles + current pattern window | Consensus probability, Edge, interval, robustness, analogs | Stale data, weak sample, or method conflict |
| EV Desk | Symbol, timeframe, current structure, risk budget | Trigger, entry zone, invalidation, target, R, or no-trade | Direction, location, or reward/risk gate fails |
| TradeReview OS | Authorized trades, candles, original self-review | Evidence review, coach redo, one action, growth proof, optional consultation case | Evidence is incomplete or rights are unclear |

Independent system contract:

| System | Input | Output | Reject / downgrade when |
|---|---|---|---|
| NQ Flow Console | Entitled NQ/MNQ trades, L2 depth, feed health, and v1.6.4 Bridge events | Flow confirmation, data health, and execution-authority prompt | Data is missing, stale, rebuilding, not entitled, or strategy version does not match 1.6.4 |
| IncomeOS | Actual weekly contribution, account value, isolated put reserve, current single-stock exposure, and derived market snapshot | Dynamic dollar allocation, growth-cycle evidence, and cash-secured-put gate | Snapshot is stale, bid/ask is missing, valuation/event gate fails, or assignment breaches concentration limits |
| TailTrend Lab | Longbridge closed daily candles, event calendar, versioned tail map, and browser-memory account risk inputs | State bucket, management zones, blockers, and stress-sized share count | Price is in the middle, confirmation is incomplete, data is stale, event/gap quarantine is active, or portfolio risk vetoes the trade |

The public `/flow/` route is a labelled simulated preview. Paid market data, provider credentials, user entitlements, and live WebSocket sessions remain on the separately authenticated service.

The public `/incomeos/` route stores account inputs and font preference only in browser local storage. Published market data is a derived read-only snapshot. The current option comparison uses last trades for research; a missing executable bid/ask is a hard rejection, not an invitation to estimate a fill.

The public `/tailtrend/` route publishes no raw candles, positions, account ledger or credentials. Its position-size form and optional OHLC import use browser memory only. Formal state transitions use completed daily closes; the intraday fast lane remains disabled until separately validated.

Scores never cross these boundaries:

- Kezhou trust score is evidence completeness, not a buy rating.
- EV Desk opportunity score is plan completeness, not win probability.
- TradeReview behavior score is within-person progress evidence, not a personality label.

## 3. Shared evidence language

- **DATA** — closed candles or contributor-authorized trade records.
- **DERIVED** — probabilities, Edge, similarity, EV, drawdown, behavior metrics.
- **FORWARD** — plans sealed before outcome and settled under stable rules; losses cannot be deleted.
- **METHOD / DEMO** — educational rules, historical narrative, or synthetic product demonstration.

TradeReview expert cases additionally use A–D levels:

- A: authorized transaction-level records.
- B: authorized timestamped plans published before outcome.
- C: public aggregate statistics or regulatory holdings.
- D: educational method or historical narrative.

Only A and B can be presented as trade replay evidence.

TradeReview contains four user-visible work areas:

1. **My review** — reconcile orders, K-lines, R, behavior evidence, and the next 10-trade prescription.
2. **Coach redo** — answer take/pass, entry, invalidation, add, reduce, and exit using only information visible at the original decision time.
3. **Growth benchmark** — compare the user with their own prior windows first, then with rights-bounded teacher ledgers, public aggregate snapshots, and research base rates.
4. **Peer consultation** — create an anonymized case link, receive private feedback, and let the originating browser select which opinions enter a public version.

Method transfer must identify itself as level D. Paul Wei behavior sequencing may use aggregate teacher-ledger evidence, but a specific post-trade answer is never described as Paul Wei's personal opinion unless the timestamped model was actually run.

## 4. Cross-product handoff

The three core workflow workspaces receive a shared stage bar containing:

- the current decision question;
- the product's valid output;
- its explicit boundary;
- the next workspace.

NQ Flow, IncomeOS and TailTrend receive the shared TraderHome navigation but no stage number and no automatic handoff. This keeps them visibly available without turning order-flow confirmation, long-term allocation or the tail/trend state machine into a hidden fourth vote inside the three existing systems.

Future authenticated versions should persist a handoff object instead of asking the user to re-enter context:

```json
{
  "symbol": "BTC",
  "asOf": "YYYY-MM-DD",
  "research": {"edge": 8, "trust": "strong"},
  "plan": {"trigger": null, "invalidation": null, "riskR": 1},
  "review": {"tradeId": null, "prescriptionId": null}
}
```

The public demo links stages without storing personal or private trade data.

Peer consultation uses URL fragments for the static deployment. Exact time, price, monetary P&L, and notes are hidden by default; normalized K-lines and R can be shared without uploading the original ledger. A server-backed community must not be implied until identity, permissions, abuse controls, deletion, and moderation are operating.

## 5. Visual system

- Base: midnight navy, cool neutral panels, restrained borders.
- Research accent: cyan — evidence and uncertainty.
- Plan accent: green — conditional action and risk gates.
- Review accent: cyan and green — evidence reconstruction and verified behavior change.
- Independent Flow accent: teal — real-time data health and execution authority.
- Independent IncomeOS accent: cyan/violet — capital allocation, compounding, and gate status.
- Independent TailTrend accent: mint/teal — edge location, confirmation, waiting, and risk veto.
- Amber: uncertainty / waiting / incomplete evidence.
- Red: invalidation, downside, failed gate, or evidence risk.

Color is never the only carrier of meaning; every status also has a text label.

## 6. User-value hierarchy

Each page should answer in this order:

1. **What matters now?**
2. **Why does the evidence support it?**
3. **What could make it wrong?**
4. **What is the single next action?**
5. **How will that action be verified later?**

Technical architecture, provider names, and implementation details belong below the user outcome, not above it.

## 7. Conversion boundary

The public site is a demonstrator. Discord / Telegram will handle category requests, beta access, and assisted use only after real invite URLs are configured. The UI must never invent or silently redirect to an unrelated community.

## 8. Success measures

Useful product metrics for the next backend stage:

- Research → Plan handoff rate.
- Percentage of plans rejected by explicit gates.
- Percentage of plans with trigger + invalidation + risk recorded.
- Percentage of closed trades self-reviewed before system reveal.
- 10-trade prescription completion rate.
- Change in target behavior frequency after prescription.
- Evidence coverage: candles, self-review, rights-cleared expert cases.
- Flow feed uptime, stale-frame rate, entitlement failures, and v1.6.4 Bridge version mismatches, reported separately from the three-stage funnel.
- IncomeOS weekly-plan completion, allocation drift, stale-snapshot rejections, concentration-gate rejections, and realized assignment exposure, also reported separately.
- TailTrend state transitions, false-reclaim rate, breakout candidate-to-acceptance rate, stale/event rejections, execution slippage, and module-level drawdown, also reported separately.

These are more informative than raw page views or short-term user P&L.
