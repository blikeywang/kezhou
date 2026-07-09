# 把仓库推到 GitHub

本目录是**干净的仓库文件(不含 .git)**,在你本机 `git init` 即可。**为保留你原来的东西,建议推到一个新仓库或新分支,不要覆盖已有仓库。**

> 说明:生成环境的挂载盘不允许清理 git 锁文件,所以没有内置 `.git`,交付纯文件——你本地初始化最干净。

## 路径 A — 用你本机的 git 或 Claude Code(推荐)

在电脑上进入这个 `kezhou-repo` 文件夹(Cowork 保存到的位置),执行:

```bash
# 1) 如果还没有 commit:
git init && git add -A && git commit -m "Initial commit: Kezhou prototype + engine + docs"

# 2) 在 GitHub 上先建一个空的私有仓库(网页或 gh),然后:
git remote add origin git@github.com:<你的用户名>/kezhou.git
git branch -M main
git push -u origin main
```

用 GitHub CLI 一步到位(会自动建库并推送):
```bash
gh repo create kezhou --private --source=. --remote=origin --push
```

若已有 Claude Code CLI,可直接在该目录里让它执行上面的 git 步骤。

## 路径 B — 授权 GitHub 连接器,由我来建库并推送

当前会话里 GitHub 连接器**尚未授权**,所以我无法直接推。你在 claude.ai 的连接器设置里授权 GitHub 后,回来告诉我,我就能通过连接器创建仓库并推送(仍会推到新仓库/分支以保留原始内容)。

## 保留原始库的做法
- 新建独立仓库(如 `kezhou`),与你原有仓库互不影响;或
- 在现有仓库里推到新分支:`git checkout -b kezhou-prototype && git push -u origin kezhou-prototype`。
- 大文件说明:`prototype/*.html` 内嵌了图表(单个约 1–2.4MB),总量约 6MB,可直接进 Git;若日后频繁改动,考虑 Git LFS 或改为"引擎返回数值、前端绘制"(见 BUILD_SPEC §3.4)。

## 安全
- `.gitignore` 已排除 `.env`、密钥与可再生中间产物。**切勿提交任何 API Key、支付密钥、私钥。**
- 推送前用 `git status` 确认没有敏感文件被纳入。
