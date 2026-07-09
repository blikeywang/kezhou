# 本次更新 · 推送到 GitHub(给 Claude Code)

仓库已在线:`https://github.com/blikeywang/kezhou`(Pages 已部署)。本次是**增量更新**,直接提交推送即可,GitHub Actions 会自动重新部署。

## 本次改了什么
- 前端 `prototype/app.html`:
  - **去掉会员/额度/付费墙**——进站直接看全部数据,无需登录/注册/选战场。
  - **"看更多"入口保留**,弹窗为 **Discord + Telegram** 两个频道(定位:看更多标的、更全信号、实时提醒)。
  - **SEO / Open Graph / Twitter 卡片 / favicon**(分享有预览图)。
  - **访问统计已接线**(GoatCounter,默认关闭;填 `GC_CODE` 即启用)。
  - OG 链接指向自定义域名 `traderhome-histroy.xyz`。
- 新增 `prototype/og.png`(分享预览图)、`CNAME`(自定义域名)、`docs/POST_LAUNCH.md`。
- `.github/workflows/daily.yml`:部署时带上 `og.png` 与 `CNAME`。

## 待填(可上线后再补,不阻塞)
- `prototype/app.html` 里 `DC_URL="#"` → Discord 邀请链接;`TG_URL="#"` → Telegram 频道链接。
- 需要统计就把 `GC_CODE=""` 填成 GoatCounter 的 code。

## 执行步骤(在仓库根目录)
```bash
# 0) 确认无密钥(应无输出)
grep -rnE "sk_(test|live)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}" . --exclude-dir=.git --exclude="*.md" | grep -vE "你的|xxx|placeholder"

# 1) 提交全部改动(.gitignore 已排除 .env / *.bak / _site / __pycache__)
git add -A
git status                      # 复查:不应有 .env、密钥、app.html.bak
git commit -m "feat: 全免费直达数据 + Discord/Telegram 入口 + SEO/OG + 自定义域名"

# 2) 推送到已有远程 main
git push origin main
```

若本地目录没有 git 历史(不是当初 push 的那份),先接上远程再推:
```bash
git init
git remote add origin https://github.com/blikeywang/kezhou.git
git fetch origin && git checkout -b main --track origin/main   # 或 git pull --rebase origin main
git add -A && git commit -m "feat: 全免费直达数据 + Discord/Telegram + SEO/OG + 域名"
git push origin main
```

## 推送后
1. 进 **Actions** 看 `daily-refresh` 自动跑并部署(或手动 Run workflow)。
2. 自定义域名:仓库 **Settings → Pages → Custom domain** 填 `traderhome-histroy.xyz`,DNS 变绿后勾 **Enforce HTTPS**(DNS 记录见 `docs/POST_LAUNCH.md`)。
3. 打开站点确认:进站直达数据、7 个标的正常、"看更多"弹窗是 Discord + Telegram。

## 红线
- ❌ 不提交密钥 / `.env` / `*.bak`。
- ❌ 不运行 `pipeline/app.py`、`pipeline/appdata.py`(已废弃)。
- ❌ `prototype/app.html` 的 `last` 必须保持 null(不下发原始价)。
