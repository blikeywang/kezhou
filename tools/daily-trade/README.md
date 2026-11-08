# 早晚报公开导出

`export-public.mjs` turns the owner's local workflow reports into the public data behind `/daily-trade/`.

```bash
node tools/daily-trade/export-public.mjs --source ~/Documents/猴认知分析   # write portal/vendor/daily-trade/data
node tools/daily-trade/export-public.mjs --stamp                          # print the source fingerprint only
node --test tools/daily-trade/test_export_public.mjs
```

On the Mac this runs from the scheduler (`tools/scheduler`, job `daily-trade`) whenever the report folder changes.

## What is read

| Source | Used for |
|---|---|
| `reports/morning/每日综合决策早报_<date>.md` | stance, headline, risk cap, freshness, Buy / Sell / 背离 / 无交叉确认, 冲浪筛选, 13 买点, risk three questions, liquidity, BTC/ETH options row, changes and gaps |
| `reports/evening/趋势冷热晚间状态_<date>.md` | class temperatures and changes, 温转热 groups, s1 temperatures |
| `data/trend/trend_history.csv` | class-level temperature heatmap (rows with `level = 大类`) |
| `data/decision/latest.json`, `data/risk_watch/latest.json`, `data/options/crypto_latest.json` | latest per-market conditions, liquidity rules, BTC/ETH term structure |

## Public boundary

- Allowlist, not blocklist: only the sections above are parsed. OKX account risk, Desk background, daily potential zones and NQ/ES detail are never read.
- Every string passes `clean()`: sentences mentioning 账户 (except the Treasury General Account), OKX, Desk, 保证金, 强平, 杠杆 or 权益 are dropped; tool log lines are dropped.
- Before writing, `privacyScan()` checks every output file for local paths, key-like fields and account terms. One hit aborts the export and nothing is written.

## Output (`portal/vendor/daily-trade/data`)

| File | Content |
|---|---|
| `index.json` | one row per day (stance, risk cap, counts, freshness), `latest`, `sourceStamp` |
| `days/<date>.json` | the parsed morning and evening report for that day |
| `trend-heatmap.json` | dates × classes temperature grid |
| `latest-extras.json` | latest market conditions, liquidity rules, BTC/ETH term structure |
| `manifest.json` | `generated_at` (capped at the end of the report day) for the freshness badge |
