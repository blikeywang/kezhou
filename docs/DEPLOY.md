# 部署与每日刷新 · Deploy & Daily Refresh

**架构：**每天后台刷新刻舟求剑 → 重算衍生曲线 → 注入 `prototype/app.html` → `portal/build_site.py` 汇总所有路由 → 部署静态页。
`/history/` 只展示归一化衍生分析；`/decision/` 与 `/review/` 发布浏览器安全快照；`/flow/` 发布明确标记的模拟订单流快照，并把真实会话留在独立授权服务中。

```
pipeline/daily/
  fetch.py   Binance(加密 4h)+ Yahoo(美股/大宗 日线)抓原始 OHLC
  build.py   OHLC → PRIM/季节性 → 前端资产(含 nc/seasyears)+ 深浅色图表
  inject.py  组装 APPDATA(7 标的 / 静态 cats·icons / last=null)→ 注入 app.html
  run.py     编排:fetch → build → inject(单标的失败自动沿用上次数据)
  meta.json  静态元数据(品类、图标、中英名)
```

---

## 一、GitHub Pages(自带,零外部依赖 —— 推荐先用这个)

`.github/workflows/daily.yml` 已就绪:每天 06:30 UTC 自动刷新并部署,也可在 Actions 页手动触发。

1. 新建 GitHub 仓库,把整个 `kezhou/` 推上去(见 `docs/PUSH_TO_GITHUB.md`)。
2. 仓库 **Settings → Pages → Build and deployment → Source 选 "GitHub Actions"**。
3. 仓库 **Settings → Actions → General → Workflow permissions 选 "Read and write"**(允许 bot 提交刷新后的 app.html)。
4. 打开 **Actions → daily-refresh → Run workflow** 手动跑一次,几分钟后 Pages 给出网址。
5. 之后每天自动刷新。

产物：`_site/`，包含统一首页、`/history/`、`/decision/`、`/review/`、`/flow/`、`/incomeos/`、`/incomeos-whole/`、`/tailtrend/` 与 `/standards/`。刻舟求剑的内容仍从 `prototype/app.html` 生成；统一首页与路由由 `portal/` 管理。TailTrend 的 Longbridge 刷新需在受信任的已认证环境手动运行，GitHub Pages 只部署已审查的派生快照。

## 二、Cloudflare Pages / Netlify(想用自定义域名更省心)

这些平台连上你的 GitHub 仓库后,**每次 push 自动部署**。工作流每天会把刷新后的
`app.html` 提交回仓库 → 触发它们自动重新部署。

- 构建命令：`python portal/build_site.py --output _site`。
- 输出目录：`_site`。
- 自定义域名:在平台后台绑定,自动配 HTTPS。

## 三、自定义域名

- 免费 `*.pages.dev` / `*.github.io` 直接可用。
- 自有域名:在 Cloudflare Pages / Netlify / GitHub Pages 后台绑定,平台自动签发 HTTPS 证书。

---

## 本地验证(不联网)

```bash
python pipeline/daily/run.py --self-test    # 合成数据跑通全链路,注入 app.html
```
> 注意:`--self-test` 会用**合成数据**覆盖 `app.html`。验证后用 git 还原,或重跑一次真实刷新。

真实刷新(需网络):
```bash
pip install -r pipeline/daily/requirements.txt
python pipeline/daily/run.py
```

## 调整

- **刷新时间**:改 `daily.yml` 的 `cron`。
- **标的**:改 `pipeline/daily/meta.json` 的 `cats` / `names`(需有对应数据源代码,见 `fetch.py`)。
- **恢复收费/更多功能**:与本刷新流程无关;见 `docs/PAYMENTS.md`、后端 `FREE_MODE`。

## 合规提醒

数据源(Binance / Yahoo)的商用/再分发授权由你负责。当前只展示**衍生归一化分析**、
每日一次快照(非实时喂价),风险较低但非零;上线前请确认授权与法务(见 `PRELAUNCH_CHECKLIST` §0/§5)。
