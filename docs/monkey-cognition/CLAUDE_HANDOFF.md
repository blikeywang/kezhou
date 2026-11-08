# Claude 接手运行与维护手册

交接基准 2026-11-08。本手册中的命令在本地“猴认知分析”根目录运行，**不是 `kezhou` 根目录**。GitHub 这里是文档包；完整运行需要用户本地研究项目、获准输入和外部依赖。先读本地 `AGENTS.md` 与 `WORKFLOW.md`，再读 [核对记录](AUDIT.md)。

## 1. 环境与可运行范围

| 组件 | 需要什么 | 缺少时怎么做 |
|---|---|---|
| 核心 Python | 支持类型注解与 `zoneinfo` 的 Python 3；本次使用的实际版本记在 AUDIT | 先跑纯函数测试，不凭猜测安装一串包 |
| 同步、发布脚本 | Node.js，主要使用原生 fs/path/child_process | 先做 `node --check`，不把语法通过当网络验证 |
| Longbridge | 已安装并配置的 `longbridge` CLI、对应行情权限 | 保留 missing/error；不自行开通付费权限 |
| TrendTrader | 环境变量 `TRENDTRADER_API_KEY` 或本地 `config/private.json` | 只生成离线报告；不输出私钥值 |
| OKX | 项目规定的只读 API 环境凭据 | 明确账户不可用；不用旧数据假装本次成功 |
| 13 买点 | 外部只读源项目及其 `node_modules/.bin/tsx`、行情依赖 | 标未接入；不创建虚假的 L1 或反写源项目 |
| 历史工作簿 | `@oai/artifact-tool` 与授权本地种子/历史 CSV | 文档/表格运行环境另行定位依赖；不是普通 npm 包已随仓库安装的假设 |
| 用户场外原页 | 用户主动发送链接、文件或文本 | 当天缺页明确缺失，不自动寻找 Claude 外部场外表 |

本次没有安装依赖、修改定时器、调用账户、刷新行情或消耗付费快照。只验证了源码/文档与本地纯函数测试。

## 2. 首次接手：先做可复核的离线检查

```bash
python3 --version
node --version
python3 -B -m unittest discover -s tests -v
python3 scripts/daily_trade.py status
python3 scripts/daily_trade.py validate --date YYYY-MM-DD
```

用真实检查日期替换占位符，逐项查看 errors/warnings、数据日期和最近 attempt。不要把 `validate` 返回 0 当成所有输入最新；warnings 也需展示。不要为了通过校验清空缺失项。

本地源码指纹与交接包 `SOURCE_INDEX.json` 比较：一致则能定位本次解释对应的实现；不一致则先查看变化。配置阈值改动必须同步方法说明。

## 3. 日常早报顺序

这是授权的日常运行顺序，不是让接手文档的首次检查自动访问所有账户。

1. 运行 `node scripts/sync_claude_sources.mjs`。确认 OTC 路由 `skipped/user_provided`，只同步获准的 S1、Desk、期权等输入；数量不一致需记录。
2. `python3 scripts/daily_trade.py import-inbox`。读结构校验结果，不把“收到文件”当“内容有效”。
3. 按用户主动提供的当日原页更新场外/潜力区，保留原始字段、异常和来源。当前这步仍有人工作用，不是写一个 notion_url 就保证全自动入库。
4. `python3 scripts/collect_okx_account.py --phase asia_morning`，只在有只读授权和环境时运行；失败应使账户层降级。
5. `python3 scripts/collect_longbridge_options.py` 做配置限制内的期权采集。显式 `--symbols TICKER.US` 模式只写该标的快照，不替换全局 equity_latest；不能把单标的刷新当全池最新。
6. `python3 scripts/s1_surf_filter.py` 完成形态及快照连续性检查。
7. 从本项目运行外部 tsx：

```bash
"../day trade/thirteen-bosses-dashboard/node_modules/.bin/tsx" scripts/sync_entry_points.ts
```

8. `python3 scripts/daily_trade.py morning --phase asia_morning --date YYYY-MM-DD`。默认会刷新宏观风险序列并生成综合早报、相关派生计划。
9. **单独运行** `python3 scripts/daily_trade.py validate --date YYYY-MM-DD`，检查报告内容与实际输入。`morning` 内部即使发现校验错误也返回 0，不能只看进程码。
10. 需要更新本地移动端时再运行 `python3 scripts/build_mobile_snapshot.py`。公开发布前另做字段白名单检查，账户派生结果不能因路径/密钥已脱敏就自动公开。

08:00 SG 是流程约定；是否已有真正调度任务需另查，不因 README 写了时间就认定自动化存在。美股盘前阶段用 `--phase us_premarket` 刷新账户与报告，目标时间按美东 09:00 换算，有夏令时变化。

## 4. 晚间与离线重建

晚间约定 19:30 SG：

```bash
python3 scripts/daily_trade.py evening --dry-run
python3 scripts/daily_trade.py evening --date YYYY-MM-DD
```

dry-run 取元数据与 tmId 解析，仍会联网；不调用付费快照。检查每批≤8、总唯一项≤120，先命中缓存再查找。正式采集失败会降级使用历史缓存并生成提示，返回成功不能证明采集成功。

离线重建示例：

```bash
python3 scripts/daily_trade.py evening --offline --date YYYY-MM-DD
python3 scripts/daily_trade.py morning --skip-risk-refresh --phase manual --date YYYY-MM-DD
python3 scripts/daily_trade.py validate --date YYYY-MM-DD
```

这些命令**会写报告/状态或导入数据，不是纯只读检查**。`--skip-risk-refresh` 只跳过宏观联网刷新；必须保留各来源真实日期。`--date` 是报告标签，不提供 point-in-time 回放。审计历史前先固定输入副本与截止时点，不能拿今天 latest.json 写成过去已知。

单独的 `risk-watch` 刷新官方宏观并生成风险层；`us-session` 生成 NQ/ES 指导，实际链/代理/缺失必须在输出可见。

## 5. 历史研究与场外展示

- S1 回测 `backtest_s1_one_share.py --as-of YYYY-MM-DD --offline` 只在所需缓存齐全时使用；参数、复权、币种、pending/open 与费用假设随结果一起保存。不能把一股研究结果称为真实组合业绩。
- `analyze_s1_market_variants.py`、`analyze_s1_us_capital.py` 依赖对应日期的回测产物，不是独立行情入口。佣金/保证金示意模型需先与当前券商官方规则核对。
- `build_history_workbook.mjs` 依赖 artifact runtime。不要因依赖缺失重新拉取禁止的 Claude 场外表；保留已授权历史 CSV。
- 场外图表先读 `outputs/otc-chart/README.md`。`build_snapshot.py` 生成白名单派生快照；公开价格另用 `update_public_prices.py`，不是对场外评级的改写。
- 只更新场外数据时使用 `copy_to_traderhome.py --snapshot-only` 的既有路径规则，避免覆盖云端更新较新的 `prices.json` 或 UI。该命令会写另一个项目，只有在对应发布任务已获授权时执行。

## 6. 报告结构与复核

输出中文，答案优先、时间清楚，至少有：数据新鲜度、大类背景、Buy 候选、Sell/回避、背离、进场止损是否可用、风险窗口、缺失输入。末尾固定“研究用途，非投资建议”。每个结论附近保留数据日与来源。

推荐每一条观察使用：`事实 → 有条件的解释 → 反证 → 下一项确认/失效条件`。不用“主力确定建仓”等无法证实的身份叙事。S2 图片按 [专门方法](S2_ANALYSIS.md) 分析；同源榜单之间互相印证不能充当多个独立证据。

查看 `make_decision_payload` 和移动端 headline 是否仍含与实际数据不符的固定文案；报告日期不代表文案自动全部更新。出现冲突先改写为可证实事实，单独列出源代码改动，不悄悄改变算法。

## 7. 失败处理

| 情况 | 处理 |
|---|---|
| 鉴权/权限失败 | 记录脱敏错误与尝试时间；不暴露凭据、不绕过限制 |
| 限频或配额不足 | 缩小到配置允许范围，保留未覆盖名单；不静默无限重试 |
| 旧缓存可读 | 可用于历史背景，标数据日与 stale；不能标今日 fresh |
| 来源身份不明 | 保留原文，停在观察；不自动套另一只同名资产 |
| S1 数量对不上 | 保留覆盖警告，核对分页/别名/Buy-only；不补造条目 |
| 13 买点失败 | 不沿用旧 L1 参与本次执行门控；成功零候选正常保留 |
| 首次 OI | 只建立基线；等可比结算日才谈 ΔOI |
| 宏观/capex/账户缺失 | 明确覆盖缺口并按已实现规则收紧预算 |
| Git 分支前进 | 重新读取最新 head，在新树上重建本次文档改动；不 force push |

## 8. GitHub 更新

本次目标 `blikeywang/kezhou` 为公开仓库。文档包位于 `docs/monkey-cognition/`，仓库根 README 只增加入口。完整研究工作区不整体上传；不复制账号、Desk、原始券商数据、原页截图、运行日志、私有配置或其他输出目录。

本地不是 Git 仓库时，不把用户整个目录直接 `git init && git add .`。可以使用 GitHub API 在现有 main 的 tree 上提交明确白名单文件，或者在获准 checkout 中只暂存该文档目录与入口。确认远端 SHA 和文件内容后才称“已推送”。本任务不需要重建网页或触发额外采集。

## 9. 可直接给 Claude 的任务说明

> 先读 docs/monkey-cognition/README.md、CALCULATIONS.md、DATA_SOURCES.md、AUDIT.md；若在本地研究工作区，还必须先读 AGENTS.md 和 WORKFLOW.md。区分 kezhou 网站与猴认知分析的路径。以源码指纹定位实现，再检查真实输入日期、覆盖和最近失败状态。更新文档或研究数据时保留来源与历史，不同步 Claude 外部场外表，不改两个只读来源项目，不上传账户/密钥/付费原文/原始券商数据。S2 图片先记录可见事实和去重不确定性，再做有日期的交叉验证；不要自造主动买卖、开平仓、净 Gamma 或胜率。修改公式须同步测试、配置说明与核对记录；发布使用文件白名单并验证远端结果。

研究用途，非投资建议。
