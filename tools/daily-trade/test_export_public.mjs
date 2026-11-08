import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clean, exportPublic, parseEvening, parseMorning, privacyScan } from "./export-public.mjs";

const MORNING = `# 每日综合决策早报 — 2026-09-21

**一句话结论：** 市场风险开关要求将标准风险倍率上限降至 0.25；账户风险数据缺失，不能核对现有仓位的开盘承压；趋势侧偏暖大类为 美股。

**假设研究账户动作：防御等待。** 今天的首要动作是等待与保留现金。

Warning: something leaked from a tool
 | Command failed: curl https://example.invalid

## 数据新鲜度

| 体系 | 数据日 | 状态 |
|---|---|---|
| 趋势冷热 | 2026-09-14 | 偏旧（7 天） |
| OKX 账户 | 2026-09-21 | 最新 |

## Buy 候选

| 标的 | 市场 | 一致度 | 交叉证据 | 进场/止损 |
|---|---|---|---|---|
| CRM | 美股 | 双支持 (+2) | 标的冷热 CRM=温；保证金率 12% | 无当日 13买点 |

## Sell / 回避

| 标的 | 市场 | 一致度 | 交叉证据 |
|---|---|---|---|
| 无 | — | — | — |

## OKX 账户开盘风险

| 项 | 值 |
|---|---|
| 权益 | 12345 USDT |

## 市场风险三开关 三问

**结论：升高；覆盖 部分覆盖。**

| 三问 | 当前状态 | 每日调查标准 |
|---|---|---|
| 油够不够？ | 红色候选 | 准备金 |

### 流动性燃料

| 指标 | 当前值 | 数据日 | 频率 | 状态 | 来源 | 解释 |
|---|---|---|---|---|---|---|
| 美国财政部一般账户（TGA） | $0.844T | 2026-09-09 | weekly | 绿色 | FRED | 参考 |

### 当前缺口

- 趋势冷热：偏旧（7 天）
- OKX 账户：读取失败
`;

const EVENING = `# 趋势冷热晚间状态 — 2026-09-21

最新采集：2026-09-16 08:54

> 在线采集失败，已回退本地缓存：URLError: <urlopen error [Errno 8] nodename nor servname provided>

## 大类整体

| 大类 | 数据日 | 温度 | 节气 | 较前次 |
|---|---|---|---|---|
| 商品期货 | 2026-09-15 | 平 | — | 温/ → 平/ |

## 温转热组合

- 温转热(美股)：CrowdStrike Holdings Inc-A(CRWD·热)、Okta Inc-A(OKTA·热)
- 温转热(ETF基金)：空

## s1 Buy 冷热

- CRM：温 / 立夏（美股）
`;

test("clean drops private sentences and markup but keeps the public TGA series", () => {
  assert.equal(clean("**A**；账户权益 100；B。"), "A；B。");
  assert.equal(clean("美国财政部一般账户（TGA）"), "美国财政部一般账户（TGA）");
  assert.equal(clean("见 [页面](/Users/me/x.html)"), "见 页面");
});

test("morning parser keeps allowlisted sections and filters account rows", () => {
  const m = parseMorning(MORNING, "2026-09-21");
  assert.equal(m.stance.label, "防御等待");
  assert.equal(m.riskCap, 0.25);
  assert.ok(!m.headline.includes("账户"));
  assert.deepEqual(m.freshness.map((f) => f.name), ["趋势冷热"]);
  assert.equal(m.freshness[0].ageDays, 7);
  assert.equal(m.buys.length, 1);
  assert.equal(m.buys[0].score, 2);
  assert.ok(!m.buys[0].evidence.includes("保证金"));
  assert.equal(m.sells.length, 0);
  assert.equal(m.risk.questions[0].state, "红色候选");
  assert.equal(m.risk.liquidity[0].name, "美国财政部一般账户（TGA）");
  assert.deepEqual(m.gaps, ["趋势冷热：偏旧（7 天）"]);
  assert.ok(!JSON.stringify(m).includes("12345"));
  assert.ok(!JSON.stringify(m).includes("Command failed"));
});

test("evening parser reads classes, warm-to-hot groups and s1 temperatures", () => {
  const e = parseEvening(EVENING, "2026-09-21");
  assert.equal(e.collected, "2026-09-16 08:54");
  assert.equal(e.offline, true);
  assert.equal(e.classes[0].change, "温 → 平");
  assert.deepEqual(e.warmToHot.find((g) => g.group === "美股").items.map((i) => i.symbol), ["CRWD", "OKTA"]);
  assert.equal(e.warmToHot.find((g) => g.group === "ETF基金").items.length, 0);
  assert.deepEqual(e.s1[0], { symbol: "CRM", temp: "温", phase: "立夏", market: "美股" });
});

test("privacy scan flags local paths and key-like fields", () => {
  assert.ok(privacyScan('{"a":"/Users/me/secret.json"}').length > 0);
  assert.ok(privacyScan('{"api_key":"x"}').length > 0);
  assert.deepEqual(privacyScan('{"name":"美国财政部一般账户（TGA）"}'), []);
});

test("export writes index, day files and an active manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "dt-export-"));
  const src = join(root, "src"), out = join(root, "out");
  mkdirSync(join(src, "reports", "morning"), { recursive: true });
  mkdirSync(join(src, "reports", "evening"), { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(src, "reports", "morning", "每日综合决策早报_2026-09-21.md"), MORNING);
  writeFileSync(join(src, "reports", "evening", "趋势冷热晚间状态_2026-09-21.md"), EVENING);
  const r = exportPublic({ source: src, out, now: new Date("2026-11-08T00:00:00Z") });
  assert.equal(r.latest, "2026-09-21");
  assert.deepEqual(readdirSync(join(out, "days")), ["2026-09-21.json"]);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  assert.equal(manifest.publishing.state, "active");
  // a report for 09-21 never looks newer than the end of that day
  assert.ok(Date.parse(manifest.generated_at) <= Date.parse("2026-09-21T23:59:00+08:00"));
  const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
  assert.equal(index.days[0].counts.buy, 1);
});

test("a day already published stays published when its source report disappears", () => {
  const root = mkdtempSync(join(tmpdir(), "dt-keep-"));
  const src = join(root, "src"), out = join(root, "out");
  mkdirSync(join(src, "reports", "morning"), { recursive: true });
  mkdirSync(join(src, "reports", "evening"), { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(src, "reports", "morning", "每日综合决策早报_2026-09-20.md"), MORNING);
  writeFileSync(join(src, "reports", "morning", "每日综合决策早报_2026-09-21.md"), MORNING);
  exportPublic({ source: src, out, now: new Date("2026-11-08T00:00:00Z") });
  rmSync(join(src, "reports", "morning", "每日综合决策早报_2026-09-20.md"));
  exportPublic({ source: src, out, now: new Date("2026-11-09T00:00:00Z") });
  const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
  assert.deepEqual(index.days.map((d) => d.date), ["2026-09-21", "2026-09-20"]);
  assert.equal(index.days[1].retained, true);
  assert.ok(existsSync(join(out, "days", "2026-09-20.json")));
});
