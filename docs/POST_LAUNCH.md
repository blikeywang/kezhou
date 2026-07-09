# 上线后 · Post-Launch(统计 / 域名 / 自动刷新核对)

站点已上线:https://blikeywang.github.io/kezhou/ 。以下三件事按需做。

---

## 1. 接入访问统计(看真实访客与行为)

代码里已埋点(`track()`:`page_view / select_market / open_symbol / premium_click …`),
现在只差接一个后端把数据收上来。推荐 **GoatCounter**(免费、无 Cookie、支持自定义事件)。

**步骤:**
1. 去 https://www.goatcounter.com 注册,选一个 code(比如 `kezhou`)→ 你的后台就是 `https://kezhou.goatcounter.com`。
2. 编辑 `prototype/app.html`,把
   ```js
   var GC_CODE="";
   ```
   改成
   ```js
   var GC_CODE="kezhou";   // 你的 GoatCounter code
   ```
3. commit + push。等下一次部署(或手动 Run workflow)。
4. 打开 `https://kezhou.goatcounter.com` 看:访问量、来源、以及自定义事件(路径形如 `evt/open_symbol`、`evt/premium_click`)。

> 想更省事、只要 PV/UV 不要事件:用 **Cloudflare Web Analytics**(后台拿一段 beacon token 贴进 `<head>` 即可),但它不收 `track()` 事件。
> 你自己的「数据后台页」(站内 `track()` 存 localStorage 的那个)仍然可用,只是只反映本机;跨用户统计以 GoatCounter 为准。

---

## 2. 自定义域名(可选,如 `kezhou.xyz`)

1. 买域名(任意注册商)。
2. **DNS 解析**:
   - 用**根域名**(`kezhou.xyz`):加 4 条 A 记录指向 GitHub Pages —
     `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153`。
   - 用**子域名**(`www.kezhou.xyz` 或 `app.kezhou.xyz`):加 1 条 CNAME 指向 `blikeywang.github.io`。
3. 仓库根目录建一个文件 **`CNAME`**,内容就是你的域名(单行,如 `kezhou.xyz`)。
   工作流已配置会把它带进部署(`daily.yml` 的 prepare 步骤)。
4. 仓库 **Settings → Pages → Custom domain** 填入域名保存;DNS 生效后勾选 **Enforce HTTPS**。
5. 换域名后,把 `prototype/app.html` 里三处绝对链接改成新域名(搜 `blikeywang.github.io/kezhou`):
   `og:url`、`og:image`、`twitter:image`。这样分享预览指向新域名。

---

## 3. 核对「每日自动刷新」真的在跑

上线是你手动触发的,确认定时任务也正常:

- **看运行**:仓库 **Actions → daily-refresh**。手动 **Run workflow** 跑一次应全绿;
  次日起每天 06:30 UTC 自动出现一条运行记录。
- **看提交**:`refresh` 任务里的 "Commit refreshed app.html" 步骤应能提交成功。
  若报权限错 → **Settings → Actions → General → Workflow permissions** 选 **Read and write**。
- **看数据真的新**:打开站点进任意标的,看「窗口」日期范围的末尾日期是否≈昨天/今天;
  或在仓库看 `prototype/app.html` 的最近提交时间(每天应有 bot 提交)。
- **Pages 没更新**?确认 **Settings → Pages → Source = GitHub Actions**。

**常见问题:**
- **定时任务停了**:GitHub 对「60 天无活动」的仓库会暂停 schedule。本流程每天自动提交,通常能保持活跃;若真停了,进 Actions 手动跑一次即可恢复。
- **抓取偶发失败**(Binance/Yahoo 限频或 429/451):`run.py` 对失败标的**自动沿用上一次数据**,不会整站空白;重试下一次即可。
- **想改刷新时间/标的**:`daily.yml` 的 `cron`;`pipeline/daily/meta.json` 的 `cats`/`names`。

---

## 之后可做(非必需)

- 填 TradingView / Discord 频道链接(`app.html` 搜 `TV_URL="#"`)。
- 加 `robots.txt` / `sitemap.xml`(单页站可省)。
- 分享冷启动:把站点发到相关社群,OG 卡片已就绪(`og.png`)。
