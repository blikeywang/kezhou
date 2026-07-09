# Kezhou · Claude Code 推送 & 部署 Runbook

> 给 Claude Code / 任何 coding agent 读的执行手册。目标:把本目录推到 GitHub 的**新仓库**,
> 开启每日自动刷新 + GitHub Pages 部署。**照着从上到下做即可。**

---

## 0. 这是什么(背景,先读)

- **产品**：刻舟求剑 / Kezhou —— 历史 K 线相似度概率工具。
- **v1 形态**：**全站免费、纯静态、只展示衍生归一化分析**(不下发原始行情价)。
- **架构**：GitHub Actions 每天跑一次 → 抓数据、重算 → **只替换 `prototype/app.html` 里的数据块** → 部署到 Pages。用户永远打开静态页,**没有实时查询、没有后端**。
- **前端唯一真源**：`prototype/app.html`(自包含单文件,内嵌数据与图表 base64)。
- **⚠️ 不要用 `pipeline/app.py` / `pipeline/appdata.py` 重新生成 `app.html`**——它们已过时(文件头有 DEPRECATED 标注),会覆盖手工改动。刷新只走 `pipeline/daily/`。

目录速览:
```
prototype/app.html         # 前端(唯一真源,CI 每天刷新它)
pipeline/daily/            # 每日刷新流水线:fetch.py build.py inject.py run.py meta.json requirements.txt
.github/workflows/daily.yml# 定时刷新 + 部署 Pages
backend/                   # FastAPI 骨架(v1 不部署;FREE_MODE=1,付费待上线)
docs/                      # BUILD_SPEC / PAYMENTS / PRELAUNCH_CHECKLIST / DEPLOY / legal ...
DISCLAIMER.md LICENSE README.md
```

---

## 1. 推送前检查(必须全过)

在仓库根目录执行,任何一项不通过就停下来报告,不要继续推送。

```bash
# 1a. 不得有任何密钥。期望输出为空。
# (只扫代码/配置;.md 文档里会出现这些「模式字符串」本身,故排除,避免误报)
grep -rnE "sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|-----BEGIN" . \
  --exclude-dir=.git --exclude="*.md" | grep -vE "你的|xxx|placeholder"

# 1b. 不得有 .env(只应有 env.example)。期望:只列出 *.example
find . -name ".env*" -not -name "*.example"

# 1c. 后端与流水线能编译
python3 -m py_compile backend/app/*.py backend/app/routers/*.py backend/app/engine/*.py pipeline/daily/*.py && echo COMPILE_OK

# 1d. 前端数据健全:7 个标的、所有 last 为 null(不下发原始价)
python3 - <<'PY'
import json,re
D=json.loads(re.search(r'<script id="APPDATA"[^>]*>(.*?)</script>',open("prototype/app.html").read(),re.S).group(1))
n=sum(len(v) for v in D["cats"].values()); assert n==7, n
assert all(a["last"] is None for a in D["assets"].values()), "raw price leaked!"
print("frontend OK: 7 cats, all last null")
PY
```

`.gitignore` 已排除 `.env`、`__pycache__`、`*.bak`、`_site/` 等,通常不用改。

---

## 2. 建仓库并推送(推到全新仓库,别覆盖任何已有仓库)

用 GitHub CLI 一步到位(推荐):
```bash
git init
git add -A
git commit -m "Kezhou v1: free static prototype + daily-refresh pipeline"
gh repo create kezhou --private --source=. --remote=origin --push
```

没有 gh 就手动建一个空仓库后:
```bash
git init && git add -A && git commit -m "Kezhou v1: free static prototype + daily-refresh pipeline"
git branch -M main
git remote add origin https://github.com/<你的用户名>/kezhou.git
git push -u origin main
```

> 推送后再跑一次 `git status`,确认没有敏感文件被纳入。

---

## 3. 开启每日刷新 + Pages(GitHub 网页操作,一次性)

在仓库 **Settings** 里:
1. **Pages → Build and deployment → Source** 选 **"GitHub Actions"**。
2. **Actions → General → Workflow permissions** 选 **"Read and write permissions"**(允许 bot 提交刷新后的 `app.html`)。保存。

然后 **Actions → daily-refresh → Run workflow**(手动触发第一次)。约 3–6 分钟后:
- workflow 里的 `deploy` 步骤会给出 **Pages 网址**(`https://<用户名>.github.io/kezhou/`)。
- 之后每天 **06:30 UTC** 自动刷新并重新部署。

若手动运行失败,查看 Actions 日志:
- `Refresh data` 步骤失败 → 多为数据源网络/限频;重试即可(单标的失败会自动沿用上次数据)。
- `deploy` 失败 → 通常是第 3.1 步 Pages Source 没设成 "GitHub Actions"。

---

## 4. 部署验证

- 打开 Pages 网址,确认:落地页正常、能进 7 个标的的分析页、深浅色/中英切换正常。
- 页面不应出现任何**绝对价格**(只有归一化曲线与「窗口涨跌(归一化)」)。
- 「进阶」弹窗指向 TradingView / Discord(链接暂为占位 `#`,见第 5 步)。

本地想先看效果(不联网,用合成数据,会临时改写 app.html):
```bash
pip install -r pipeline/daily/requirements.txt
python pipeline/daily/run.py --self-test     # 合成数据跑通全链路
git checkout -- prototype/app.html           # 看完还原真实数据
```

---

## 5. 交给人来做的收尾(不是 agent 的活,列出提醒即可)

1. **TV/Discord 链接**:编辑 `prototype/app.html`,把 `var TV_URL="#",DC_URL="#";` 换成真实频道链接,commit。
2. **自定义域名**(可选):Pages / Cloudflare Pages / Netlify 后台绑定,自动 HTTPS。见 `docs/DEPLOY.md`。
3. **合规**:数据源(Binance/Yahoo)商用/再分发授权与法务(免责/条款)由本人确认;当前为每日一次的**衍生快照**,风险较低但非零。见 `docs/PRELAUNCH_CHECKLIST.md` §0/§5。

---

## 红线(agent 千万别做)

- ❌ 不要提交任何密钥 / `.env` / `sk_...` / `whsec_...` / 私钥。
- ❌ 不要运行 `pipeline/app.py` 或 `pipeline/appdata.py`(已废弃,会覆盖 `app.html`)。
- ❌ 不要把 `--self-test` 的合成数据 commit 上去(跑完记得 `git checkout -- prototype/app.html`)。
- ❌ 不要给 `prototype/app.html` 加回原始价格字段(`last` 必须为 null)。
- ❌ 不要覆盖用户已有的其它仓库——推到新仓库或新分支。
```
