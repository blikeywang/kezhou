# 数据契约与可审计记录

版本：2026-11-08。这是后续 Desk 记录的建议契约；**不是声称现有日报所有 JSON 已迁移到这个 schema**。既有日报以本地脚本的校验器为准，不直接覆盖旧结构。

## 1. 时间与来源

| 字段 | 含义与校验 |
|---|---|
| `report_date` | 报告归属日，不是全部输入的数据日 |
| `generated_at` | 本报告生成时间，ISO 8601，必须带偏移或 UTC |
| `market_as_of` | 本次分析截至哪个市场时点，不得晚于实际取得证据的时间 |
| `source_published_at` | 原文/公告发布时间；不明为 null |
| `observed_at` | 报价或事件观测时间；日频数据另有 `data_date` |
| `collected_at` | 实际采集时间；不能替换 `observed_at` |
| `available_at` | 当时最早可取得该版本数据的时间；历史研究防止未来信息泄漏 |
| `session` | regular / pre_market / post_market / overnight / eod / not_applicable |
| `timezone` | IANA 时区；市场采用 America/New_York，展示采用 Asia/Singapore |
| `source_id`, `source_url`, `provider` | 可追溯来源，不用只有“网络”二字的标签 |
| `evidence_type` | verified_fact / reported_claim / calculated / scenario / judgment / missing |
| `status`, `missing_reason` | fresh / stale / missing / access_denied / fetch_failed / partial / not_applicable；失败原因明确 |

未来时间戳、价格在不可能的交易时段内更新、昨日盘前值被当今天值，都必须拦截或标待核对。工作日计数不等于交易所日历；周末最近正规收盘可以有效，但只能叫最近收盘。报告文件修改时间不证明行情新鲜。

## 2. 证据记录

每个结论保存：`claim_id`、简短转述、所属类型、来源定位（页码/段落/视频时间码）、适用市场、样本群、时间窗、单位、前提、反证、缺失项。计算结果再保存公式名/版本和各输入的 `source_id`。

聚合流量要区分：实际已成交 / 条件式未来估算；美元金额 / 张数 / 名义金额 / 权利金；美国 / 全球；单日 / 一周 / 一月。不得仅因货币单位相同就相加。

原始资料放本地审计层，标准化数据另存；不修改原始截图“修复”数值。重复链接去重，但有修订的正文/公告保留版本。发布只使用获授权摘要，不复制完整付费内容。

## 3. 股票与期权输入

股票至少包含 `symbol`、`exchange`、`currency`、`price`、`observed_at`、`session`、`adjustment`、`previous_regular_close` 及其日期。K 线需 `open/high/low/close/volume`、bar 起止时间和 `closed`；需验证高低关系、非负量和复权一致性。

期权至少包含：

- `underlying`、供应商原始 `contract_symbol`、`expiry`、`last_trading_at`、`option_type`、`strike`。
- `multiplier`、`deliverable`、`adjusted_contract`、结算/行权方式；非标准合约不能套用标准 100 股公式。
- `bid/ask`、各自时间/数量、`last/last_at`；买卖价需非负且 `bid <= ask`。零 bid 是流动性风险，不与缺失混为一谈。
- `volume/volume_as_of` 与 `open_interest/oi_data_date` 分开；ΔOI 还要上期同合约数据日。
- `iv` 用小数还是百分数必须显式声明；`greeks` 的 Vega/Theta/Rho 单位和 modeled/observed 状态逐项列出。
- 标的报价与期权报价的时差；期权数据权限和延迟标记。

`spread_pct_mid = (ask-bid)/((ask+bid)/2)*100`，mid=0 时无定义。Mid 仅作盘口宽度参考，不保证成交。未设定并验证具体流动性阈值时，不偷偷添加“价差小于某数一定安全”的自动规则。

多腿价差要求同标的、同到期、同币种、可比乘数与交割物、同张数；保留各腿独立时间。合约变更需 OCC 映射，不能靠字符串相似或数量级自动拼接。

## 4. 合成缺失记录示例

以下故意保留报价缺失，说明“不知道”如何落盘；不是实际行情或待执行订单。

```json
{
  "schema_version": "desk_research_proposal_v1",
  "is_synthetic": true,
  "report_date": "2000-01-03",
  "generated_at": "2000-01-03T15:00:00Z",
  "market_as_of": null,
  "symbol": "SYNTHETIC_ONLY",
  "evidence_type": "missing",
  "status": "missing",
  "source_url": null,
  "quote": {"bid": null, "ask": null, "observed_at": null},
  "missing_reason": "演示：没有可核实的当时盘口，不计算可成交收益",
  "decision": {"stance": "wait", "rationale": "关键输入缺失"}
}
```

## 5. 日报兼容与验收

既有 `daily_trade.py` 包含 OTC、潜力区、期权、冲浪、forced-flow、账户和整个 workspace 校验器。改数据结构前先读调用方和测试；`data/status.json` 与各路 `status.json` 是运行状态，不是新鲜行情证明。

所有新记录先写候选、校验，再原子更新 latest 与历史。对同日修订保留 run_id/时间戳审计版本；旧脚本可能同日覆盖，详见 [日报注意事项](DAILY_REPORTS.md)。无数据、成功但零候选、未扫描、扫描失败必须分别表示。

分数默认不是概率。S1 强制流量评分中缺项记 0 是该评分函数的设计，必须同时展示覆盖率；它不允许把原始数值字段里的 missing 改成 0。

研究用途，非投资建议。
