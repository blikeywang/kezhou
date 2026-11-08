# 运行、验证与移交步骤

基线2026-11-08。以下命令来自本机现有入口；本次只运行离线测试，没有执行每日采集、重算历史策略或触发定时任务。`YYYY-MM-DD`须替换为明确的报告日期。

## 1. 运行位置和依赖

本GitHub目录是**说明书，不是可独立运行的完整源码包**。命令必须在用户原“猴认知分析”研究根目录运行；先读该目录当前的`AGENTS.md`和`WORKFLOW.md`。复制本README不能复制供应商授权、私有输入或外部引擎。

- Python脚本主要使用标准库和本项目模块；类型语法要求Python 3.10或更新版本，并需要可用的IANA时区数据库。实际测试解释器版本记在`validation.json`，不要把“能运行”当作所有版本兼容保证。
- Node脚本使用ES modules；`sync_claude_sources.mjs`和工作簿构建依赖`@oai/artifact-tool`。优先复用用户原环境，不凭空创建未验证的依赖锁文件。
- `sync_entry_points.ts`静态导入外部13买点项目的TS源文件，需相应运行器及依赖。**2026-11-08检查时该配置路径不存在**，只有运行器不能修复缺少的规则引擎。不要在只读参考目录自行重建或修改它。
- Longbridge采集需要本机已授权CLI与对应市场权限。先用`longbridge --help`核对版本和参数；不要把认证输出放进GitHub或报告。
- TrendTrader由程序读取`TRENDTRADER_API_KEY`或本机`config/private.json`；OKX由程序读取三个凭据环境变量。接手者不需要把这些值显示出来；OKX必须由用户确认只开Read权限。
- IBKR/Alpaca历史适配器的具体导入方式见[S1说明](S1_SURF_BACKTEST.md)。存在适配器不等于账户已经登录或拥有全部行情授权。

## 2. 先做不联网的检查

```bash
python3 -B -m unittest discover -s tests -p 'test_*.py' -v
```

本次现有核心测试为40项，覆盖导入/报告的一部分、账户归一、冲浪和3/5日证据。测试并未覆盖所有策略与资金边界。完整退出码、测试数、源码哈希和文档链接检查见`validation.json`与`source_inventory.json`。

`python3 scripts/daily_trade.py validate --date YYYY-MM-DD`检查本机实际输入结构和新鲜度，不联网刷新行情。它不是全功能回测审计；输出可能包含本机路径，不应原样上传公开仓库。本次交接没有把私有实时输入验证结果公开。

## 3. 日常更新的依赖顺序

这是一份编排步骤，不是可以忽略任何失败继续跑完的“一键脚本”。各步完成后检查状态文件、数据日、覆盖和错误；单步退出0不能代替内容校验。

1. 保存用户主动提供的原文/文件和接收时间，确认S1完整度、日期、别名、同日冲突。只收到Buy必须保持Sell未知。
2. 每日任务开始运行只读旧资料同步，场外分支必须仍为`skipped / user_provided`。注意当前同日S1覆盖缺陷；同步前保留已接受清单及哈希，出现差异先解决来源优先级。

   ```bash
   node scripts/sync_claude_sources.mjs
   python3 scripts/daily_trade.py import-inbox
   ```

3. 用户场外原页走日期特定intake核验，保留候选/历史/来源；不可用旧Claude场外表补齐。当前通用OTC JSON导入与中文历史表schema并不统一，不能盲目导入。
4. S1导入成功后逐候选刷新冲浪，明确闭合日K截止和快照连续性。

   ```bash
   python3 scripts/s1_surf_filter.py --as-of YYYY-MM-DD --refresh
   ```

   `--offline`只读已有价格缓存，但仍写筛选结果；缓存旧时必须降级，不能把命令执行日当行情日。

5. 恢复并核验外部只读依赖后，从研究项目运行`sync_entry_points.ts`。源码内部相对import也必须能解析。没有依赖时记录13买点缺失，禁止编造点位或L1。
6. 需要账户风险且用户已配置只读账户时：

   ```bash
   python3 scripts/collect_okx_account.py --phase asia_morning
   ```

   密钥缺失/采集失败要保留attempt状态和最近成功时间；账户数据只留本机。不要为填满报告而猜测权益、仓位或止损。

7. 运行有界期权采集，检查监测池、预检数、深扫数、被跳过原因、OI比较日和Top3进程卡。

   ```bash
   python3 scripts/collect_longbridge_options.py --date YYYY-MM-DD
   ```

   **这里的`--date`主要是报告标签，不是供应商历史快照截止。** 不能用今天的接口配旧日期声称历史回放。

8. 准备具名NQ/ES、潜力区监控、资本开支和慢指标输入；缺失则显式保留缺失。`morning`不会自动补齐这些采集器。
9. 生成早报（默认刷新官方宏观序列），然后单独检查校验退出码和内容。

   ```bash
   python3 scripts/daily_trade.py morning --date YYYY-MM-DD --phase asia_morning
   python3 scripts/daily_trade.py validate --date YYYY-MM-DD
   ```

   `morning`即使内部校验有错误仍可能返回0。不能使用“上一命令成功”作为发布许可。`--skip-risk-refresh`只跳过宏观联网，不表示全程只读，也不补其他输入。

10. 校验无ERROR、限制披露完整后才能构建阅读快照：

    ```bash
    python3 scripts/build_mobile_snapshot.py
    ```

    手机终端是既有**私有**发布对象。其快照可能含脱敏账户数字，不得上传公开kezhou。部署动作、公开日报、场外网页分别按原授权和白名单执行，本README不新增公开权限。

## 4. 晚间与美盘前

- 晚间19:30 Asia/Singapore：先同步获准来源，再运行`python3 scripts/daily_trade.py evening --date YYYY-MM-DD`。付费快照必须先tmId缓存、每批不超过8、总数不超过当前配置120。`--dry-run`仍可能请求状态/搜索等接口及更新缓存；不是离线模式。`--offline`不请求TrendTrader，但仍生成报告。
- 早间08:00 Asia/Singapore：按上节顺序运行。
- 美股交易日09:00 America/New_York：采集`--phase us_premarket`账户，生成同phase早报，并按需运行`daily_trade.py us-session --date YYYY-MM-DD`。美国夏令时变化由时区规则处理，不固定换算成某一个新加坡小时。
- 以上来自项目手册，是计划说明；本次没有创建、重启或验证实际自动任务调度器健康度。不能承诺仅贴一份S1后就持续后台监控或自动提醒。

## 5. 回测与资金报告

按[S1/回测说明](S1_SURF_BACKTEST.md)先确认策略是固定±1股还是每次信号累加。冻结原文版本、实际可见时刻、证券身份、公司行动、日历、价格源、费用版本和资金假设，再回放。

已有三份回测/资金脚本会覆盖相同日期产物，并含部分历史硬编码文案；修复前不能将重新运行的报告直接当成无时点偏差的新结论。认真比较至少应包括：原始信号与冲浪筛选、信号日理想化价格与实际可知后的可成交价格、只多与多空、毛收益与含费用收益、最大日终敞口与账户真实保证金。

## 6. 故障处理

| 现象 | 正确处理 |
|---|---|
| S1解析数量不符 | 停止采用这版；保留原文与声明数量；不丢行凑数 |
| Buy-only / 同日多版 | 明确coverage与版本；不把未知Sell变0，不丢撤回记录 |
| 行情缺失 / 限流 | 写缺失和provider错误；按既有显式降级保留来源；不反复绕过拒绝 |
| 13引擎缺失 / confidence不兼容 | 不编造L1；记录阻断项和修复测试 |
| 期权ΔOI缺前基线 | 标记无法比较；不把成交量或任意更早快照称作次日新增OI |
| 原页断档 | 保存缺页；不插值、不跨断档确认节点 |
| 网站部署失败 | 本地报告保留，提示线上未更新；不把本地生成当远端已发布 |

同日期重跑前，先保存输入与旧产物的版本/哈希及运行ID，备份放在本项目允许的产物目录。原始历史不能靠覆写后的`latest.json`还原。

## 7. 文档发布与接手验收

本次公开路径仅`docs/trading-research-handoff/`，只含Markdown和两份核对清单。提交必须以远端最新main为父提交，保留其余树，更新ref时带旧SHA校验且不强推。推送后再读取远端README和提交文件列表，确认没有覆盖产品README或混入数据。

Claude接手的验收：能定位来源/公式与实际代码；能复跑离线测试；能指出缺数据而不是造结论；能区分已实现与待修；能使用明确时点和不可变输入重算；不会把研究文件接到订单系统。若仅获得公开文档而无本机源码和私有授权，应明确说“可阅读，尚不可运行”。

研究用途，非投资建议。
