# 主流市场模拟分析：公开页面与云端模拟盘

公开地址：https://traderhome-histroy.xyz/market-simulation/

页面由 GitHub Pages 原生托管，没有 iframe、ChatGPT 登录或浏览器内的服务凭据。
原有模拟盘数据库继续保存订单和研判，网站改版不清空账本、不重新计算历史成交，也不触发新的交易。
单标的和组合是各自独立的模拟账户；真实券商账户不参与本发布链路。

## 三个独立时间

1. **交易检查**：既有云端任务每 10 分钟调用模拟引擎，读取新行情并按已发布计划检查进出场。
2. **模型复核**：既有 ChatGPT 云端小时任务审核交易与计划，将合理或挂起的结论写回同一模拟数据库。
3. **公开发布**：GitHub Actions 的 `publish-traderhome` 按 UTC 每小时第 6、16、26、36、46、56 分钟读取只读快照，并部署整个网站。网页每分钟检查新版本。

这些工作都不依赖个人电脑开机。GitHub 的 schedule 是尽力调度，可能延后或漏跑；
界面分别显示执行时间、复核时间、发布时刻和每个标的实际行情截止时间，不能用新抓取时间掩盖旧报价。
官方限制：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

## 发布流程

- `.github/workflows/pages.yml` 负责唯一的 Pages 发布入口：主分支页面变更、定时任务、手动触发，以及每日数据刷新成功后运行。
- `.github/workflows/daily.yml` 保留原有每日数据刷新和回归检查；不再单独部署，以免覆盖模拟盘的新快照。
- `tools/market_simulation/export_public.py` 仅 GET 固定来源的 dashboard API。禁止跨源重定向，不调用执行、重置、开关或复核写入接口。
- 来源的访问凭据只保存在仓库的 Actions Secret `MARKET_SIMULATION_SITE_TOKEN`。设定时由已有云端配置直接使用 GitHub 公钥加密，明文不进入仓库、网页或日志。
- 构建后生成 `market-simulation/data/latest.json`、轻量版本文件 `status.json` 和延迟加载的 `history.json`。网页先检查版本，只有版本改变才重新下载账本。只发布显式列出的模拟业务字段；计划、成交、事件、行情来源、模型复核与校验值保留，运行配置和自动任务内部标识不输出。
- 模拟数据属于发布产物，避免每 10 分钟把整份账本重复提交到 Git 历史。GitHub Actions 运行和 Pages 部署保留发布记录。
- 读取、格式检查或凭据检查失败即中止部署；线上保留最后一次完整成功版本，页面按时间自动标记滞后，不补造行情或订单。

## 保留的内容

完整单标的及组合成交账本、未平仓、冻结的入场依据、进出场点位、手续费、模拟净盈亏、事件记录。
展示 10M / 1H / 4H / 1D / 1W 当前研判、有效条件计划、VWAP 与成交密集区，以及组合比值和单腿结构参考。
公开短线研判窗口约为最近 60 小时，长周期每个标的最多 60 份；完整原始档案继续保存在云端数据库。
小时复核公开最近 48 份；成交事件中的既有复核理由继续保留。

公开图表与单腿目标只用于展示原始结构，不改变模拟执行规则。
新入场挂起只作用于对应账户、标的和周期，既有止损、止盈及保护性退出继续由原引擎执行。
组合参考目标使用已有结构；超出已知结构的 ATR 投射显式标记。比值换算是单腿价格不变的条件情景，不给出虚假的唯一双腿目标。

## 本地验证

```sh
python -m unittest discover -s tools/market_simulation -p 'test_*.py'
python -m unittest portal.test_portal
node --test portal/test_market_simulation.mjs
python portal/build_site.py --output /tmp/traderhome-preview
```

普通本地构建不包含私密来源凭据或模拟数据种子。生产由 Actions 的导出步骤填充数据；
本地预览可复制已验证的公开 JSON 到构建产物的 `market-simulation/data/`。
不要为了预览把云端配置或凭据复制进公开目录。


## BTC / ETH 订单流证据

`tools/market_simulation/crypto_flow.py` 同时用于云端小时复核客户端与 GitHub 公开导出。
固定读取 OKX 无需认证的公开统计接口：币种现货主动买卖量、USDT 永续主动买卖量（`unit=0`，币数量）、永续 OI 历史（使用 `oiCcy`），以及同一场所的 5m 完整价格柱。
来源文档：https://www.okx.com/docs-v5/en/ 。这是一家场所的证据，不是全市场合成 CVD。
现货主动量按币种聚合、图表价格为 USDT 单交易对；永续量统计与 K 线总量可能不同，`volumeCheck` 显示差异，不能宣称逐笔全量一致。

- CVD 是真实主动买量减主动卖量的累加，不以红绿 K 线、OBV 或普通成交量替代。最多连续 24 小时样本；发生缺口即重新锚定，跨快照不可直接比较累计水平。
- 使用时间区间对齐的 15m / 1h / 4h 流量变化、价格变化与币本位 OI 变化。OI 美元估值另列，避免混淆币价变动和实际增减仓。
- 预留 5 分钟统计缓冲，只读完整价格柱；OI 精确匹配区间结束时的观测，不静默前向填充。超过 20 分钟标旧；缺失返回 unavailable/incomplete，不补零。
- 区间背离筛选比较当前 CVD 与此前 4 小时极值、同期价格极值，价格容差 2bps，CVD 差异阈值为参照窗口总主动量的 0.2%。同向候选至少相隔 1 小时。后续 1 小时内收盘突破此前 15 分钟高/低点记为结构确认；收盘越过参照区间失效位则标失效。发现时刻与后续确认时刻分别留档，不倒填入场。
- 这是供模型判断的明确筛选规则，既不是穷尽所有形态的识别器，也不是新增自动进出场规则。短时背离不单独否定日/周结构；模型仍评估成本、阻力/支撑、止损与费用后目标。
- collector 的失败不妨碍原账本发布。页面在 CVD / OI 页签展示真实可用数据和状态，模型失去这项证据不等于所有策略必须挂起。

云端 `/workspace/scripts/market-hourly-review.py context` 会追加 `cryptoOrderFlow`，并保存 `flow-<evidenceId>.json`。
小时模型摘要写明证据编号、完整数据截止时间及 BTC/ETH 判断；复核写回后仍须读回校验。
网页每十分钟独立取样，数据可能比复核证据更新，各有采集时刻，不能假称同一快照。
用户临时标注的结构价存在带有效期的 `user-references.json`，只作待核实参考，不永久写进策略。
