# 埋点与后台统计设计 — Analytics & Admin

目标:知道**多少人来、多少人注册、多少人激活、多少人在什么行为下付费、大家爱看什么**,并能在后台记录与查看。配合 `FEATURES_v2.md §F`(内容分层)。

---

## 1. 身份与会话
- 匿名访客:首访生成 `anon_id`(cookie/localStorage);注册/登录后与 `user_id` 绑定并**回填历史事件**(把匿名期行为并入该用户)。
- `session_id`:30 分钟无操作断开;用于会话级统计。
- 每条事件都带:`anon_id / user_id? / session_id / ts / plan(free|pro) / lang / device / ref(来源)`。

## 2. 事件字典(Event taxonomy)
| 事件 | 关键属性 | 用途 |
|---|---|---|
| `page_view` | screen | 流量、页面漏斗 |
| `signup` / `login` | method | 注册转化 |
| `select_market` | market | 战场偏好 |
| `open_symbol` | symbol, market, demo?, custom? | **激活**、热门标的 |
| `search` / `resolve_confirm` | query, symbol?, found? | 检索需求、长尾标的 |
| `paywall_view` | symbol, feature | 付费墙触达 |
| `quota_hit` | market | 额度耗尽(另一付费触发点) |
| `upgrade_click` | **context**(lock/quota/nav/pricing) | **在什么行为下想付费** |
| `upgrade_success` | plan, **context**, price, pay_method | **转化 + 触发来源归因** |
| `favorite_add` / `list_create` | symbol / listId | 粘性 |
| `refresh` | symbol | 刷新需求、限速命中 |
| `explain_toggle` | on/off | 新手/老手比例 |

## 3. 核心漏斗与指标
**转化漏斗**:访客 → 注册 → 激活(打开首个标的)→ 触达付费墙/额度墙 → 点击升级 → 升级成功。每一环算转化率与流失。

**必看指标**:
- 规模:DAU/WAU/MAU、新访客/回访。
- 转化:注册率、激活率、**免费→Pro 转化率**、付费墙点击→升级率。
- **付费触发归因**:`upgrade_success.context` 分布——多少人是因为"锁定内容"付费、多少因"额度用尽"、多少主动点升级。这直接指导定价与卡点设计。
- 内容偏好:热门标的 Top N、各战场占比、检索/长尾标的需求、平均每人每日查询数。
- 留存:次日/7日/30日留存;收藏/自选与留存的相关性。
- 健康度:按需 fetch 命中率与耗时、限速命中、错误率。

## 4. 存储与实现
两种路线,可并行:
- **产品分析平台**(快):接 PostHog(可自托管)/ Amplitude / Mixpanel,前端 SDK 直接埋点,自带漏斗/留存/看板。
- **自建**(可控):前端 `track(event, props)` → 批量上报 `/collect` → 落 ClickHouse/BigQuery;后台用 Metabase/Superset 或自建看板查询。
建议:MVP 用 PostHog 快速起量;数据敏感或要精细归因时并行落自建数仓。

**上报要点**:客户端批量 + `navigator.sendBeacon` 保证离开页也上报;服务端对关键转化(`upgrade_success`)以**支付 Webhook 为准**二次确认,避免前端刷量。

## 5. 隐私合规
- Cookie/同意横幅(GDPR/《个人信息保护法》);可关闭非必要分析。
- 不采集敏感个人信息;IP 脱敏;数据保留期与删除请求流程。
- 明确区分"必要(登录/额度)"与"分析"用途。

## 6. 后台看板(原型已演示)
`数据后台` 页展示:转化漏斗、免费→Pro 转化率、**付费触发来源分布**、热门标的 Top、战场占比,以及**本会话真实记录的事件流**(证明"能记录")。
> 原型的看板数据 = 合成的历史样本(便于展示) + 你本次会话被真实 `track()` 记录的事件;生产接入上文平台/数仓后即为真实全量。
