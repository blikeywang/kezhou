# 日报流程、历史数据位置与运行交接

核对日：2026-11-08（Asia/Singapore）。核对依据：本机 `AGENTS.md`、`WORKFLOW.md`、配置、脚本源代码和目录清单，以及 kezhou 的公开导出器/索引。**本次没有重新采集行情、生成日报、修改调度或迁移历史。**

## 1. 三个根目录，不要混用

| 代号 | 本机位置/定位方式 | 用途 |
|---|---|---|
| `PROJECT_ROOT` | 用户 Documents 下的 `猴认知分析` 项目 | 独立日报的代码、配置、私有输入、标准化历史与完整报告 |
| `CLAUDE_TRADE_ROOT` | 默认 Documents 下的 `trade every day info`；脚本支持同名环境变量 | 只读历史参考与获授权的 S1 / Desk / 期权输入；场外路由禁止 |
| `ENTRY_SOURCE_ROOT` | Documents 下的 `day trade/thirteen-bosses-dashboard` | 13 买点只读规则和行情源，当前接入脚本使用相对导入，不能随意挪动目录 |
| `TRADERHOME_REPO` | 当前机器配置的 `kezhou`/TraderHome checkout；既有本地约定是 Documents 下的 `US/traderhome` | 公开站点与公开派生摘要；先核验 Git remote，不凭文件夹名称推定 |

这些是定位说明，不是授予 Claude 任意读写权限。公开 GitHub clone **不包含整个独立日报项目、私有历史和凭证**。权限细节见 [ACCESS_MATRIX.md](ACCESS_MATRIX.md)。

## 2. 每日顺序

| 时间 | 顺序 | 主要产物 |
|---|---|---|
| 19:30 Asia/Singapore | 检查配置/配额 → 只读同步获准输入（OTC skipped）→ 导入校验 → 趋势更新 → 晚报 → 历史/状态校验 | 晚报、趋势历史、追踪工作簿（满足安全前提时） |
| 08:00 Asia/Singapore | 同步/导入 → 私有账户基线 → 长桥期权/forced-flow → 官方宏观 → 用户当日场外/潜力区 → S1 冲浪 → 13 买点 → 早报/最终动作/期权页 → validate → 私有手机快照 | 早报与研究附件、三行推送摘要 |
| 美股交易日 09:00 America/New_York | 账户/扩展时段再采 → 风险刷新 → `_美股盘前` 早报 → NQ/ES 期权指导 → 核对 Fed/BLS/Treasury/财报 → validate | 盘前早报、us-session 报告 |

09:00 ET 在美东夏令时为新加坡 21:00，冬令时为 22:00；用时区库转换并核对交易日，不硬编码全年时间。候选数量、成交盘口和事件窗口不能用早上快照无条件延续到美盘。

这里描述的是项目要求的节奏，不证明调度进程当前在线。kezhou 的公开导出调度与日报生产调度是两套事情；“今天重新导出”不表示“今天生成了新日报”。

## 3. 运行前检查与命令入口

以下命令只在用户明确要求运行日报、且本机权限已配置时使用。此次交接没有执行这些采集/生成命令。先完整阅读项目当前的 `AGENTS.md` 和 `WORKFLOW.md`。

### 前置条件

1. Python 3、支持项目类型语法的 Node、Longbridge CLI；Node 的 `@oai/artifact-tool` 依赖用于同步/工作簿脚本。不要擅自全局安装或更改用户运行时。
2. 检查 `config/workflow.json`：`otc_source.mode` 必须为 `user_provided`，`ignore_claude_external` 必须为 true。配置缺失时 **停止同步**；同步脚本的旧默认值可能走 `claude_sync`。
3. TrendTrader `tmId` 优先查 `data/trend/tmid_cache.csv`；本次配置批量上限 8、总快照上限 120。执行当天重新读配置，不擅自提高上限。
4. 读取并保护已有历史；重复运行同日之前先在项目 `outputs` 中保留带 run_id/时间戳的审计副本。不要将当前数据回填成过去的 as-of 数据。
5. 账户数据只有在用户授权、API 仅 Read 权限时采集。缺权限仍可生成缺失状态的研究报告，不索取 Trade/Withdraw 权限。

本次配置的新鲜度自然日阈值：OTC、潜力区、趋势、S1、13 买点、期权均为 1 日，Desk 为 2 日。这只是粗粒度报告门控，不能据此把一天前的期权盘口当当前可成交价；具体行情仍需逐字段时间。账户、宏观不同频率另有规则。

从 `PROJECT_ROOT` 运行的只读配置门控示例（不输出密钥）：

```bash
python3 -c 'import json; c=json.load(open("config/workflow.json")); s=c.get("otc_source", {}); assert s.get("mode")=="user_provided" and s.get("ignore_claude_external") is True, "STOP: OTC source boundary"; assert 0<c["snapshot_batch_size"]<=8 and c["max_snapshot_items"]<=120; print("source/cap preflight OK")'
```

如果未来用户批准改变限额，应同步更新门控和文档；不要为通过断言而偷偷改配置。

### 同步与早报

逐步运行、每步看状态，不把下列命令一次性盲串：

```bash
node scripts/sync_claude_sources.mjs
python3 scripts/daily_trade.py import-inbox
python3 scripts/collect_okx_account.py --phase asia_morning
python3 scripts/collect_longbridge_options.py
python3 scripts/daily_trade.py risk-watch
python3 scripts/s1_surf_filter.py
node --experimental-strip-types scripts/sync_entry_points.ts
python3 scripts/daily_trade.py morning --phase asia_morning
python3 scripts/daily_trade.py validate
```

在风险刷新与冲浪步骤之间，人工处理用户当日主动提供的场外/潜力区材料；没有收到就标缺失，不能自行转去外部场外表。13 买点 TS 文件已在本机 Node v22.23.1 做过语法检查，**未在本次运行扫描**。2026-11-08 只读检查未在当前配置相对路径找到外部 `app/lib/signal-engine.ts`；所以语法通过不等于扫描可运行。接手先恢复获授权的只读依赖或明确缺失，不在其他目录擅自改造替代源。

S1 同步要核对页面声明的 Buy/Sell 数量；同步失败不得拿前一天结果冒充当日。冲浪缺行情不等于不符合形态。13 买点零候选是合法结果，供应商失败是另一个状态。

`collect_longbridge_options.py --symbols SPY.US QQQ.US SMH.US` 可用于定向研究（参数已核对），写逐标的快照而不覆盖总 `equity_latest.json`；不要误以为它替代了整个日报监测池。预算/候选上限仍需检查配置。

### 晚报、盘前与私有终端

```bash
python3 scripts/daily_trade.py evening --dry-run
python3 scripts/daily_trade.py evening
python3 scripts/daily_trade.py validate
```

`--dry-run` 不调用付费快照，但不是整个项目的“无网络/无副作用沙盒”保证；仍应读采集计划和实际代码。`evening --offline` 会用缓存生成报告，仍会写文件，不能称作实时更新。

美股交易日前置输入更新后：

```bash
python3 scripts/collect_okx_account.py --phase us_premarket
python3 scripts/daily_trade.py risk-watch
python3 scripts/daily_trade.py morning --phase us_premarket
python3 scripts/daily_trade.py us-session
python3 scripts/daily_trade.py validate
```

默认 `morning` 自身还会刷新宏观；若先运行 `risk-watch`，这是重复调用而非独立证据。`--skip-risk-refresh` 仅可在确认同轮已成功刷新后采用；跳过不代表数据新鲜。

早报校验通过后，已有私有站点流程可运行 `python3 scripts/build_mobile_snapshot.py`，在 `outputs/mobile-market-terminal` 构建/测试并复用既有私有托管项目。它生成已发布快照，不提供实时连接，不可将站点改为公开或每日新建站点。

历史工作簿入口为 `node scripts/build_history_workbook.mjs`，输出 `outputs/daily-trade-workflow/场外与趋势历史追踪表.xlsx`。**现有脚本在 OTC CSV 缺失时会从旧种子工作簿恢复**；这与当前 user-provided-only 边界有冲突风险。必须先确认用户来源的 `data/otc/otc_history.csv` 已存在且有效，缺失时停下，不运行种子回退。此次只记录问题，没有改生产代码。

## 4. 完整早晚报历史在哪里

所有路径相对于 `PROJECT_ROOT`。Markdown 为审计底稿，HTML 为阅读版；“文件数”包含这两种格式，**不是交易日数**。

| 类别 | 精确目录/命名 | 本机文件清单（2026-11-08 核对） |
|---|---|---|
| 早报 | `reports/morning/每日综合决策早报_YYYY-MM-DD.md` / `.html` | 116 个 md/html，文件名日期 2026-07-17 至 2026-09-21 |
| 美股盘前早报 | 同目录，`每日综合决策早报_YYYY-MM-DD_美股盘前.*` | 计入早报目录数量，不另当一个交易日 |
| 晚报 | `reports/evening/趋势冷热晚间状态_YYYY-MM-DD.md` / `.html` | 110 个，2026-07-17 至 2026-09-21 |
| 最终研究动作页 | `reports/decision/每日最终操作计划_YYYY-MM-DD.*` | 106 个，2026-07-21 至 2026-09-21 |
| 期权学堂/雷达 | `reports/options/期权学堂与异常机会雷达_YYYY-MM-DD.*` | 106 个，2026-07-21 至 2026-09-21 |
| 美盘 NQ/ES 指导 | `reports/us-session/美盘NQ_ES期权指导_YYYY-MM-DD.*` | 104 个，2026-07-20 至 2026-09-21 |
| 专题研究 | `reports/research/` | 25 个 md/html，文件名日期 2026-07-21 至 2026-10-09 |

**本机早晚报历史尚未见 2026-09-21 之后的文件。** 这是目录盘点，不证明日期区间内每天完整、报告内容正确、其他机器没有副本或调度已经停止。接手时重新盘点，不补造缺日。

## 5. 标准化数据、输入、状态的位置

| 路由 | 当前/历史/状态 |
|---|---|
| 趋势 | `data/trend/trend_history.csv`、`tmid_cache.csv`；原始响应 `data/trend/raw/`（不公开） |
| S1 | `data/s1/signals.csv`；`data/s1/surf/latest.json`、`surf/history/`、`surf/market_data/` |
| 强制流量 | `data/s1/forced_flow_latest.json`、`data/s1/forced_flow_history/` |
| 13 买点 | `data/buy_points/buy_points.csv`、`data/buy_points/status.json` |
| 场外 | `data/otc/latest.json`、`otc_history.csv`；`potential_zones_latest.json` / `potential_zones_history.csv`；`potential_monitor_latest.json` / `potential_monitor_history.csv` |
| Desk | `data/desk/latest.json`；获授权原文/摘要输入在项目 inbox 与既有本地参考层（不随本包公开） |
| 期权 | `data/options/{proxy,futures,equity,crypto}_latest.json`、`options_history.csv`、`equity_history/` |
| 逐标的期权 | `data/options/<小写标的>/latest.json` 和 `history/<小写标的>_YYYY-MM-DD.json` |
| 市场风险 | `data/risk_watch/{macro_latest,slow_latest,latest,status}.json` |
| 账户（严格私有） | `data/account/okx_latest.json`、`okx_status.json`、`history/`；导入快照 `inbox/account/` |
| 最终研究计划 | `data/decision/latest.json` |
| 同步与全局状态 | `data/sync_status.json`、`data/status.json` |
| 自动推送摘要 | `outputs/daily-trade-workflow/daily_push_latest.json` 和 `.md` |
| 私有手机端 | `outputs/mobile-market-terminal/public/data/snapshot.json`；绑定 `.openai/hosting.json` 不公开 |

`inbox/options` 是获准外部期权输入的暂存区，不能回写外部来源。同步脚本还沿用 `references/claude` 作为既有参考缓存；这不是新任务任意在根目录建文件的授权。新交接产物写入 `data/reports/outputs` 范围。

## 6. 现行计算与规则定位

这里只记录日报增补部分；期权公式详见 [CALCULATIONS.md](CALCULATIONS.md)。权重/阈值以当时配置和代码为准，报告必须记规则版本。

| 模块 | 当前逻辑/约束 | 本地实现入口 |
|---|---|---|
| 方向一致度 | 热/温/沸 +1，平 0，凉/寒 -1；同向 +1，反向 -1，中性/缺失 0。**当前代码相加标的冷热、大类冷热、场外三项**；≥3 三支持、2 双支持、1 单支持、0 待确认、负数背离。不是概率 | `daily_trade.py: alignment, score_signal` |
| 经济方向 | 反向 ETF 的原始 Buy 保留；大类/场外按偏空敞口解释。过期 OTC 不参与确认，Sell 未直接覆盖时不随意借大盘确认 | `score_signal` |
| 冲浪 | 20 交易日下跌后 5–9 日低波动震荡；幅度/ATR/红绿交替/斜率/下沿容差与连续快照门控；配置覆盖默认值。结构分只排序，次日确认不证明供应商历史标记未移动 | `s1_surf_filter.py: DEFAULT_RULES, analyze_surf_structure, classify_candidate` |
| 强制流量 | 近期 Buy/Sell 先报价预检，3/5 个近似交易日阶段、ATR 归一响应、期权成交/IV/ΔOI 分层证据；0–100 分与覆盖率并列 | `s1_forced_flow.py: quote_precheck, daily_price_profile, build_forced_flow_payload, build_option_process_card` |
| 13 买点 | 正规时段闭合 5m，至少 100 根；外部规则、流动性、代理止损与 1R/2R；公开降级行情最高 L0，缺量不升 L1；没有点位不编造 | `sync_entry_points.ts: qualityCap, main`，外部只读 `signal-engine.ts` |
| 资本开支 | `qoq_t = capex_t/capex_(t-1)-1`；“二阶导”代理为相邻环比增速之差（百分点），不是连续微积分。至少 3 家有效官方口径，多数绝对额上升但增速下降才列候选 | `daily_trade.py: _capex_watch` |
| 宏观/拥挤 | 准备金、SOFR-IORB、TGA、回购、资本开支、慢指标各自日期；启发式风险线不是央行官方红线。关键缺失/候选触发风险降档；不计入方向一致度 | `build_market_risk_watch` 与配置 `market_risk_watch` |
| 账户风险 | gross=long+short，net=long-short，杠杆=gross/净值；一阶缺口压力=Σ方向×对应名义金额×扩展时段涨跌；覆盖率<50%时只称局部影响。不能用长桥价算 OKX 强平 | `collect_okx_account.py: liq_distance_pct, attach_market_references, compute_risk` |
| 最终条件清单 | **规范要求**冲浪确认、至少一路独立同向、当日 13 买点 L1、账户/宏观风险允许；其他只观察。现行代码有门控缺口，见下文，不能把输出直接执行 | `daily_trade.py: make_decision_payload` |

旧 `WORKFLOW.md` 的规则层只写两项、最高“双支持”，与当前 `score_signal` 三项实现存在差异。交接保留该差异，不静默改分数或声称旧文档已修正。缺项得 0 仅指排序积分，原始观测值仍为 missing。

另已直接核对：13 买点接入层写 `confidence="L1 分数 · #方法"`，下游却严格比较 `confidence == "L1"`；账户缺失也不是 `make_decision_payload` 中完整的拒绝条件。不要因屏幕显示“条件参与”就认为所有条件已验证。更完整的评分权重、资金模型与工程缺口见仓库已有的 [研究系统交接](https://github.com/blikeywang/kezhou/tree/main/docs/trading-research-handoff)；本包没有修复这些生产问题。

## 7. 公开历史在 kezhou 哪里

当前实际使用的是 [公开导出器说明](https://github.com/blikeywang/kezhou/blob/main/tools/daily-trade/README.md) 和 `tools/daily-trade/export-public.mjs`，不是将整个私人项目上传。

| kezhou 路径 | 内容 |
|---|---|
| `portal/vendor/daily-trade/data/index.json` | 日期索引、latest、sourceStamp、hasMorning/hasEvening |
| `portal/vendor/daily-trade/data/days/YYYY-MM-DD.json` | 按日白名单派生早晚报，不是完整私有原文 |
| `portal/vendor/daily-trade/data/trend-heatmap.json` | 大类温度历史 |
| `portal/vendor/daily-trade/data/latest-extras.json` | 导出器已有的研究条件/风险/加密期权派生摘要 |
| `portal/vendor/daily-trade/data/manifest.json` | 新鲜度与旧 HTML 路由兼容信息 |
| `portal/vendor/daily-trade/reports/YYYY-MM-DD/{morning,evening}.html` | 旧 HTML 归档；不要当作完整新索引 |

2026-11-08 核对公开 `index.json`：57 个日期，2026-07-17 至 2026-09-21，57 日有早报、55 日有晚报。`exportedAt` 为 2026-11-08T01:45:35.206Z，但 `latest` 仍为 2026-09-21。旧 HTML 路由仍指向 2026-08-14；这与新版 JSON 57 日历史不是同一个覆盖范围。未来以实际索引重新核对，不把导出时间当数据时间。

网页入口是 [TraderHome 日报](https://traderhome-histroy.xyz/daily-trade/)。本次核对的是 GitHub 源文件，未独立证明 CDN/浏览器缓存已同步到最新提交。

### 后续发布的安全步骤（本次未运行）

1. 本地完整报告 validate 无 ERROR；内容核查通过。允许公开的是已批准白名单，不是整个报告/账户/Desk。
2. 先读远端导出器和测试，确认实际输入范围。它会读取 `decision/latest.json` 的选定摘要，与本地旧手册“不得复制最终动作页”需区分；**既有代码能力不授予新增公开权限**，扩展字段先确认。
3. 在 `TRADERHOME_REPO` 运行导出器时，`--source` 指向确认的项目，`--out` 优先指向项目 `outputs` 内的审计候选目录；检查脱敏后再复制白名单。
4. 导出器会删除并重建目标 `days/`。必须确认输入历史完整、备份目标，防止新环境的少量文件把既有 57 日公开历史裁掉。
5. 执行 `node --test tools/daily-trade/test_export_public.mjs` 和 `python3 -m unittest portal.test_portal`；检查 Git diff，仅提交授权公开产物，不上传原始 JSON、账户或完整付费正文。
6. 推送后核对 commit、部署结果、实际 index.latest 与网页新鲜度。失败则保留本地报告并标“网站未更新”。

导出器 `sourceStamp` 只哈希最新早晚报及指定 latest 数据，并加文件数量；修改较老报告但数量不变可能不触发自动检测，历史修订要显式检查。`_美股盘前.md` 不匹配其基础早报文件名正则，不会自动作为新一日发布。

本地旧 `scripts/publish_traderhome_reports.mjs` 直接复制整份早晚报 HTML，还可能修改目标门户路由；它不是逐字段脱敏器。禁止因文件名在白名单就直接公开含账户/付费内容的 HTML，也不要让旧 manifest 覆盖新版导出结构。根目录旧 `CLAUDE_CODE_RUNBOOK.md` 是 Kezhou 初始建站说明，不是此日报项目的运行手册，不照抄其中“新建仓库/全量 add”的步骤。

## 8. 已知失败模式与验收

- `morning`、`us-session` 可能即使校验异常仍退出 0；`evening` 在线失败会回退缓存并退出 0。必须另跑 `validate`，检查错误、warnings、各路时间和采集状态。
- 旧 `age_status` 可把未来日期视为“最新”，工作日 age 未剔除交易所假日。接手层需额外检查未来时间戳和交易日历，不能仅信标签。
- `--date` 只是报告归属日，不会自动重建当时可见数据，不能用它制造无未来信息的回测。
- 同日 `.md/.html` 及部分 JSON 历史路径会被重写；这与“旧报告不得覆盖”的要求有张力。正式更新前保存修订副本并列差异，不依靠文件名实现不可变归档。
- 来源代码复用/公司行动可能污染期权聚合历史；出现映射警告时排除该字段，不拼旧代码填空。
- 工作簿种子回退、OTC 同步默认模式、旧 HTML 发布器属于已记录风险，**此次均未修改生产实现**。

日报验收：日期/来源完整；缺失醒目；无编造点位；实际/代理分层；账户与宏观风险不加方向分；Top3 进程卡有反证；推送直接读 `daily_push_latest.json`，卡片缺失就写缺失；本地/私有站点/公开站点成功分别报告。

研究用途，非投资建议。
