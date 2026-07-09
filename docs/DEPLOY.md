# 部署与每日刷新 · Deploy & Daily Refresh

**架构:** 每天后台跑一次 → 重算衍生曲线 → 注入 `prototype/app.html` → 部署静态页。
用户永远打开的是**纯静态网页**,不做实时查询。全站只展示归一化衍生分析,不下发原始价。

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

产物:`_site/index.html`(= 最新 `app.html`)。想换首页文案/图标只改 `prototype/app.html`。

## 二、Cloudflare Pages / Netlify(想用自定义域名更省心)

这些平台连上你的 GitHub 仓库后,**每次 push 自动部署**。工作流每天会把刷新后的
`app.html` 提交回仓库 → 触发它们自动重新部署。

- 构建设置:**无需构建命令**(纯静态)。
- 输出目录:仓库根;**把 `prototype/app.html` 设为首页**——两种做法任选:
  - 在平台的部署设置里把 `prototype/` 设为发布目录,并把 `app.html` 重命名/映射为 `index.html`;或
  - 在仓库根加一个 `index.html`,内容为 `<meta http-equiv="refresh" content="0; url=prototype/app.html">`。
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
