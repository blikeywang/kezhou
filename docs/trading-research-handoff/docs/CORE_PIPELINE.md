# 核心数据流、计分与研究方法

版本基线2026-11-08。控制证据是本项目当前代码和配置；旧README/WORKFLOW是规范与意图，出现差异时在此明确列出，不自动修正代码。

## 1. 模块角色

| 模块 | 回答的问题 | 不负责什么 |
|---|---|---|
| S1 | 哪些代码被用户提供为Buy/Sell？ | 不验证供应商底层算法、不直接下单 |
| 冲浪 | 是否出现前跌、低波动横盘、B保留代理和后续守位？ | 不增加独立方向分、不证明信号不重绘 |
| 趋势冷热 | 标的与大类的来源温度是否支持原信号？ | 温度分类不是概率 |
| 场外/潜力区 | 来源周期与板块、价格观察区是否支持？ | 没有今日原页不补造；阈值节点不是订单 |
| 13买点 | 已闭合5分钟结构是否给出候选价/代理止损？ | L0/L1不免除人工结构/成交核对 |
| 期权 | 量、波动率、OI是否出现需调查的异常与延续？ | 不识别机构身份，不由OI推断净Gamma |
| Desk | 叙事、流动性、事件窗口有什么风险？ | 不覆盖机械信号 |
| 宏观/账户 | 是否应降风险、现有持仓压力是否可算？ | 不把账户加入方向评分，不自动清仓 |

研究问题与数据粒度对应：S1是“来源日×代码×方向”，冲浪是“代码×闭合日K窗口”，13买点是“代码×闭合5分钟K”，期权逐合约是“代码×到期×行权价×Call/Put×时间”。不能在不同粒度上直接相加或把日期相同当时刻一致。

## 2. 导入与去重的实际实现

### 2.1 CSV入口

`scripts/daily_trade.py::import_inbox`（1484行起）：按文件名排序读取 `inbox/s1/*.csv`；去掉action/symbol首尾空白，action转小写；只纳入有date、symbol且action合法的行。

`append_dedup`（197行起）按 `(date, action, symbol)` 的**原始字符串**去重，旧键保留，不覆盖同键内容。它没有统一代码别名，也不是源版本数据库。`700.HK`与`00700.HK`可能同时保存在原始CSV，后续模块再归一。

影响：

- 同日先发精简名单、再发补全名单，CSV通常做并集；不能仅靠这个表知道后来是否撤回了某条信号。
- 同日Buy/Sell是两个不同键，会同时存在；冲突应由后续规则或审计提示处理。
- 同键的name/note纠错不会靠重导同一个CSV自动更新；必须保留版本证据后有意修订。
- 标准CSV导入不会自动建立所有intake/覆盖状态；用户粘贴路径要同步写审计intake与`sync_status.s1`。

### 2.2 Claude旧HTML只读入口

`scripts/sync_claude_sources.mjs::syncSignals`：选文件名日期最新的当日选择HTML，按章节解析，按`action|symbol`去重，核对页面声明Buy/Sell数。数量不符则失败，不采用。

**重要差异**：成功HTML同步会先删除CSV中该来源日的全部行，再放入当前HTML解析结果；CSV导入是追加去重。二者语义不同。

脚本有`preserveAcceptedInboxS1`：已接受的用户intake日期不早于上游，或上游失败时，保留用户来源的**状态标签**。但`syncSignals()`是在状态判断之前执行，已成功写过CSV。因此“状态保留”不完全等于“CSV未被同日HTML覆盖”。接手优先补覆盖保护测试。

同步器同时处理Desk与期权；场外由配置`otc_source.mode=user_provided`固定跳过。代码仍留有旧`syncOtc`分支，不能擅自把配置改回自动外部场外同步。

### 2.3 其他入口的边界

- `inbox/otc/*.json`通用导入器验证日期/market_bias/sectors，再写`latest`并追加扁平历史；它不是完整的44/49项原页审计器。
- 当前研究历史场外CSV使用“日期/品类/场外指数/爆破指数”等中文列；通用扁平入口使用`data_date/level/key/score/...`。两种口径不能盲目共写同一CSV；更新场外应沿用当前专用intake流程。
- Desk先考虑JSON，若没有Desk JSON才提取Markdown；若残留旧JSON，新增Markdown可能不被采用，需核对来源日。
- NQ/ES输入在合法候选中按`report_date → richness → 文件名`选最佳；按`report_date,instrument,coverage`去重历史。报告日/丰富度不是实际报价时效的替代品。
- BTC/ETH选择文件名最新输入，规范化后落盘；本模块不负责重新向原交易所抓数。

## 3. TrendTrader采集与成本保护

实现：`daily_trade.py::TrendTraderClient`（1616），`resolve_signal_tmids`（1671），`collect_trend`（1726）。

顺序：

1. `getUpdateStatus`获取各tmId来源日。
2. 加入6个大类上下文；读取3个“温转热”组合的成分。
3. 对最新S1 Buy查本地`tmid_cache.csv`，未命中才按代码/名称调用`searchTicker`；优先精确代码及市场，次选精确名称，唯一结果才兜底。
4. 对上下文tmId去重。默认超过120个直接报错，不进入snapshot。
5. 按8个一批调用`getTickerSnapshot`；字段为`tickerName,asset,trendTemperatureCurr,trendPhaseCurr`。
6. 标准化来源日优先snapshot自带`asOfDate`，否则updateStatus；原响应本地归档；历史按`collect_dt,level,group,tmId`追加。

当前6类及tmId：A股303121、ETF基金377042、美股332171、商品期货300144、加密币327801、美国ETF704988。组合tmId为622485/622460/622495。它们是配置基线，不保证供应商永不调整。

`--dry-run`只避免调用付费snapshot：它仍初始化客户端、查状态、组合成分，可能搜索并更新tmId缓存；**不是全离线、零外部调用模式**。总量限制在这些读取之后，不能当所有API的通用费用封顶。

## 4. 一致度：代码现在是三项，不是旧手册的两项

`daily_trade.py::score_signal`（2050行起）实际计算：

```text
temperature_score: 沸/热/温 → +1；平 → 0；凉/寒 → -1
align(s, action): s缺失或0 → 0；s与action方向相同 → +1；否则 → -1

total = 标的冷热对齐 + 大类冷热对齐 + 场外对齐
```

标签：`≥3 三支持；2 双支持；1 单支持；0 待确认；<0 背离/降级`。范围通常`-3…+3`；不是概率、预期收益或统计显著性。

选择细节：

- 标的冷热只来自最新一次采集中的`level=buy列表`；未覆盖记0而不是反向。
- 大类映射按market；港股没有独立大类时会回退A股，属于代理关系。
- Sell若没有`sector_key`、标的冷热或已识别反向ETF覆盖，不用宽泛大类替其制造直接确认。
- 场外优先对口sector；没有sector时仅Buy可回退大类，Sell不无条件取大类。
- 场外`source_status`为缺失/失败/过期等列举值时不参与对齐。
- 反向ETF识别目前依赖note中“经济敞口为偏空”或“反向纳指ETF”等文字；原始Buy保留，标的冷热仍按Buy，大类/场外按偏空解释。没有通用证券主数据的完整杠杆/反向敞口映射。
- 冲浪状态仅附加`surf_*`字段，不加分。期权证据也不直接加到这个total。

**限制**：`score_signal`不接收报告日，内部不能独立保证趋势记录新鲜；应核对调用端是否过滤，而非只看报告顶部的过期警告。标的与大类冷热同源，不可称为两个统计独立证据。

## 5. 新鲜度与缺失处理

- `age_status`（2018）用自然日差；日期缺失→缺失，差≤允许天数→最新/可用，否则偏旧。未来日期当前也落入“最新”。
- `business_age_status`（2028）只跳周六日，不含交易所节假日；来源日≥报告日直接视作最新。
- `latest_trend_data_date`（1879）取最新采集大类来源日中的最小值，表示最慢一类；每个标的仍须单独看asOfDate。
- 缺失值与零值必须分开。一次成功零候选扫描应显示ready/0，不应显示行情失败；本次失败不能复用之前L1做当日门控，已有相关测试。
- `WARN`表示结构校验无ERROR但数据存在警告，不等于所有市场输入都可交易。

## 6. 报告生成不等于全流程采集

`daily_trade.py morning`默认刷新宏观、导入inbox、组合已落盘输入、生成Markdown/HTML、最终动作与每日期权推送摘要，并进行校验。

它**不会代替**S1原文入库、冲浪采集、13买点、OKX采集及Longbridge期权采集。调度器必须按顺序先运行这些步骤。`--skip-risk-refresh`可跳过宏观网络，但仍会读写导入与报告，不是完全只读命令。

`morning`完成后无论validation是否含ERROR，当前main分支仍返回0；因此调度不能仅靠morning退出码放行发布，必须单独运行`validate`并检查其退出码/`errors`。

主要输出：

- `reports/morning/每日综合决策早报_日期.md/.html`
- `reports/trend/`：晚间趋势状态；以实际生成文件名为准
- `reports/decision/每日最终操作计划_日期.md/.html`与`data/decision/latest.json`
- `outputs/daily-trade-workflow/daily_push_latest.json/.md`
- `data/status.json`记录最近流程结果；不是交易账本

手动日期参数不能自动把输入都裁成历史可知快照。重复生成同日同phase报告可能覆盖同名产物，运行前保存修订版本；“文件名带日期”并不等于不可变审计日志。

## 7. 规范中的完整条件链

```text
信号身份/时序可信
  AND 冲浪确认
  AND 至少一路独立体系同向
  AND 当期13买点L1及可用结构坐标
  AND 价格/流动性/事件风险人工复核
  AND 有效账户风险与预算允许
  → 研究条件清单（仍不是订单）
```

实际`make_decision_payload`与上述规范有差异，详细见风险文档和限制清单：尤其L1字符串协议不匹配，账户缺失并未硬阻断所有conditional状态。接手者不能仅阅读此链条就认为每一条已被程序保证。

研究用途，非投资建议。
