# TraderHome Product System

## 1. North star

TraderHome is one evidence-led trading workflow with three bounded workspaces:

1. **Kezhou / Research** — turn current market shape into a falsifiable historical hypothesis.
2. **EV Desk / Plan** — turn a directional hypothesis into a conditional plan with invalidation and risk.
3. **TradeReview OS / Growth** — turn completed execution into evidence review, a coach redo, a measurable growth stage, and an owner-controlled consultation case.

The product should reduce unstructured action, not increase the number of signals a user consumes.

## 2. Product contracts

| Workspace | Input | Output | Reject / downgrade when |
|---|---|---|---|
| Kezhou | Closed historical candles + current pattern window | Consensus probability, Edge, interval, robustness, analogs | Stale data, weak sample, or method conflict |
| EV Desk | Symbol, timeframe, current structure, risk budget | Trigger, entry zone, invalidation, target, R, or no-trade | Direction, location, or reward/risk gate fails |
| TradeReview OS | Authorized trades, candles, original self-review | Evidence review, coach redo, one action, growth proof, optional consultation case | Evidence is incomplete or rights are unclear |

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

Every workspace receives a shared stage bar containing:

- the current decision question;
- the product's valid output;
- its explicit boundary;
- the next workspace.

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

These are more informative than raw page views or short-term user P&L.
