# 主流市场模拟分析：dot 运行交接

用户授权dot负责BTC、ETH、XAU、XAG、NQ、CL的模拟研判、计划和复核。电脑可能关闭，使用dot云端电脑与已连接云端工作区。结果写回模拟服务后同步到 https://traderhome-histroy.xyz/market-simulation/ 。

## 已核实状态（2026-10-01 01:38 Asia/Singapore）

- dot十分钟研判任务 `6abd3ec7e13881918a7ca5ad02b218d1` 已保存并启用。实际定时尝试已触发；01:20轮读取工作区失败，不能记作有市场依据的观望决定。
- dot小时复核任务 `6abd45248c088191950fefd51c0b7f94` 已保存、启用并读回；每小时第5分钟，首次计划02:05。新结果提交/读回尚未验收。
- 原小时任务 `6abb28a744fc8191bba34014d60da581` 已由原承载会话暂停，回执 `success=true`，读回 `is_enabled=false`、`next_run_time=null`。配置和历史保留；不要再次启用造成两个小时写入者。
- 复核卡片部署 `36748040380` 成功，匿名读回确认新版卡片与真实快照已发布。最新有效复核仍为 `hourly-20260930T0015Z`，旧绿标均按历史判断显示。
- 当前阻塞为MarcoPolo工作区持续MCP超时；十分钟撮合cron有实际成功记录，与模型读取/提交链路分开。手动交接验证的提交响应不确定，恢复后先读回再决定是否重试，禁止倒填成功或制造成交。
- dot保留日程在后台恢复。只有实际新的模型/复核ID提交并读回后才验收；仅保存日程不等于十分钟问题解决。

## 交接验收

1. 核对上述新小时任务的启用状态、运行环境和失败记录；原任务保留历史且处于暂停状态。避免两个小时写入者。只有新任务被明确停用后，才能由原承载会话恢复旧任务作为回退。
2. 保存十分钟模型研判的日程，Asia/Singapore，覆盖六标的；每小时复核全部仓位、有效计划、最近两小时平仓和旧挂起。分钟粒度支持与实际运行延迟须实测，不能仅把日程写进文档。
3. 先做一轮标为手动交接验证的读取→真实判断→提交→读回，报告唯一id、证据id、写回结果、日程回执。再核对后续实际定时运行。没有证据不得称完成。
4. 十分钟撮合cron是既有独立服务，不重复创建、不倒填历史。仅模拟盘，无真实券商交易。

## 可用云端入口

通过已连接的MarcoPolo `workspace_shell` 使用持久工作区：

- 说明 `/workspace/workflows/market-hourly-review.md`。
- 客户端 `python3 /workspace/scripts/market-hourly-review.py context`。
- 复核提交 `python3 /workspace/scripts/market-hourly-review.py submit <输入JSON路径>`。
- 模型计划提交 `python3 /workspace/scripts/market-hourly-review.py plan <输入JSON路径>`。
- 完整资金流证据由 `context.cryptoOrderFlow.fullEvidenceFile` 指定。
- 执行器 `/workspace/scripts/sixlab-cloud-runner.py`；已存在每十分钟cron。

认证已经由固定目标客户端读取云端私密配置，不能输出、传送认证值，也不能放入聊天、公开仓库或页面。只向既有模拟服务写入。源服务原址为 https://hourly-six-lab-blikey.blikeywang.chatgpt.site ，公开阅读使用TraderHome。

## 每十分钟应当完成的事

阅读当前快照和数据时间，每个标的给出当前方向、关键成本/结构、下一步行为。存在可执行机会时给出入场区间、原始止损、目标和失效条件；观望时说明哪一条件未成立以及下一步触发条件。仓位管理结合费用、原保护价、近端支撑阻力，不强制为了次数开仓。组合观察金银、金油、BTC/黄金、ETH/BTC、NQ/黄金，并检查单腿结构与敞口。

现有模型写入接口支持10M计划。输入必须覆盖六标的，`snapshotRun`与最新账本相同；`dataThrough/price`须为对应最后完整5M柱的收盘边界和收盘价。有效期10–120分钟，风险不超过原引擎单笔上限，费用后最差入场价格RR至少1。缺行情、休市或结构不成立不造计划。1H/4H/1D/1W结构和原计划继续审视，但不能虚称这个接口已经支持五周期模型计划写入。

```json
{
  "id":"dot-model-YYYYMMDDTHHmmZ",
  "snapshotRun":1234567890000,
  "validMinutes":20,
  "thesis":"本次六标的市场判断",
  "pairs":"组合观察及现有仓位管理",
  "assets":[
    {"symbol":"BTC","dataThrough":1234567890000,"price":100,"bias":"wait","regime":"结构等待","summary":"当前依据","counter":"失效/反向证据","next":"下一步触发条件","plan":null}
  ],
  "exits":[]
}
```

示例只有一个标的供展示字段；真实输入必须有六个且不能复制示例价格。方向`long/short/wait`；有计划时`plan={entryZone:[下沿,上沿],stop:价,target:价,riskFraction:比例}`。可用`exits=[{book:"single"或"pair",tradeId:原仓编号,reason:结构退出依据}]`提交受控模拟退出请求；下一轮撮合执行，提交不等于成交。409须重新取快照再判断，不能只换时间戳。ID保证幂等，未确定结果先读回。

## 每小时复核与显示格式

遵循完整云端说明，覆盖所有requiredTargets和旧挂起，提交后核对review.history。BTC/ETH使用1H价格拐点A/B对应的同锚点CVD与同期永续OI；A/B可以跨日跨周。价格为该小时柱影线极值，CVD/OI为同柱收盘边界；现货栏OI是同期永续OI。只用完整柱，未确认拐点单独标记，OI增减不直接说明多空方向。

`summary`按`【总览】`、`【BTC】`、`【ETH】`、`【其他市场】`、`【组合与仓位】`、`【风险与下一步】`、`【数据依据】`分段，总长6000字符以内；每项`reason`按`【结论】`、`【依据】`、`【保护与风险】`、`【恢复或下一步】`分段，3000字符以内。公开页面据明确标题分框，保留原始完整记录。

## 监控与通知

单独检查十分钟执行、模型研判、小时复核、网页同步的真实时间。网页GitHub Actions虽配置十分钟schedule，目前运行记录有数小时空隙，不能宣称精确保证十分钟公开更新。dot应报告丢失的步骤并尝试在现有授权内恢复，不拿一次手工更新冒充持续调度。只有失败、数据异常、挂起/解除变化、需要用户处理或首次验收完成才通知；正常结果直接写网页。
