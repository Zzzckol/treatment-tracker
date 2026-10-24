# 治疗跟进 · 部署与使用说明

一个装在手机上的网页工具，用来长期跟踪放化疗 + 免疫治疗的日程、化验指标、身体反应和就诊资料。

数据存在你自己手机里，不上传任何服务器。提醒通过 GitHub Actions 定时触发、Server酱 推到微信。

---

## 一、5 分钟部署

### 1. 建仓库

在 GitHub 新建一个仓库，比如 `treatment-tracker`，**Private 也可以**（Pages 需要 Public，见下）。

把这个文件夹里所有文件传上去。命令行方式：

```bash
cd treatment-tracker
git init
git add .
git commit -m "初始化"
git branch -M main
git remote add origin https://github.com/你的用户名/treatment-tracker.git
git push -u origin main
```

### 2. 开 Pages

仓库 → Settings → Pages → Source 选 `Deploy from a branch` → Branch 选 `main`、目录 `/ (root)` → Save。

等 1-2 分钟，访问 `https://你的用户名.github.io/treatment-tracker/`。

> 注意：GitHub Pages 免费版要求仓库 **Public**。如果不想公开代码，可以改用 Cloudflare Pages（支持私有仓库免费托管），上传方式一样。

### 3. 手机上装成 App

- **iPhone**：Safari 打开上面的网址 → 底部「分享」→「添加到主屏幕」
- **安卓**：Chrome 打开 → 右上角菜单 →「添加到主屏幕」/「安装应用」

装完之后从桌面图标打开，全屏无地址栏，跟 App 一样，**断网也能用**。

---

## 二、打开微信提醒（可选，但你选了要）

### 1. 拿 SendKey

1. 手机或电脑打开 <https://sct.ftqq.com>
2. 微信扫码登录
3. 复制页面上的 **SendKey**（`SCT` 开头）
4. **重要**：按页面提示扫码关注「方糖」公众号，不关注收不到消息

### 2. 填到 GitHub

仓库 → Settings → Secrets and variables → Actions → New repository secret

- Name: `SERVERCHAN_KEY`
- Secret: 你复制的 SendKey

### 3. 开启 Actions

仓库 → Actions 标签页 → 如果提示 workflow 未启用，点「I understand my workflows, go ahead and enable them」。

### 4. 在网页里同步日程

打开网页 → 「更多」→「微信提醒推送」：

1. 填 SendKey（本地留个记录）
2. 填 GitHub Token：GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾上 `repo` 权限
3. 填仓库：`你的用户名/treatment-tracker`
4. 点「同步日程到云端」

之后**每次改了日程，都要回来点一次同步**，否则云端还是旧数据。

### 5. 测试

仓库 → Actions → 「每日治疗提醒」→ Run workflow → 在 force 里填 `1` → Run。

一分钟内微信应该收到测试消息。

**默认推送时间**：北京时间每天早上 8:00 和晚上 20:00。改时间就编辑 `.github/workflows/remind.yml` 里的 cron（UTC 时间）。

---

## 三、日常怎么用

### 第一次用

1. 「更多」→「患者信息与方案」，把诊断、分期、医院、主治医生、化疗周期天数填上
2. 「日程」→「自动排期」，填本轮化疗第 1 天的日期 → 一次排出往后 4-6 个周期的化疗、查血、疗效评估
3. 「日程」→「排放疗」，填总次数 → 自动跳过周末
4. 排完逐条点进去改（医院通知的具体时间、地点、要带的东西）

### 化疗期间每天

- **今天页**：看今天要做什么、下次还有几天，做完点一下打勾
- **记录页**：点格子记今天的不适程度 + 体温体重，30 秒

### 每次拿到化验单

「指标」→「录入化验单」，只填有数值的项，正常的可以跳过。或者用「批量粘贴」：把医院 App 里的文字整段复制过来，自动识别。

录两三次之后，重点指标（白细胞、中性粒、血红蛋白、血小板、肝肾功能、甲功）就会出趋势线，红色的点表示超出参考范围。

### 复诊前

「更多」→「生成就诊一页纸」→ 打印或存 PDF 带给医生。上面有最近异常指标、近 14 天不适、治疗进度。

---

## 四、数据安全（请认真看）

**数据只存在手机浏览器的本地数据库里，没有云端备份。**

以下操作会丢数据：

- 清理浏览器数据 / 清除网站数据
- iPhone 上删除 Safari 网站数据
- 换手机
- 用无痕模式

所以：

1. **每周点一次**「更多」→「备份全部数据」，把导出的 JSON 存到网盘或发给自己微信
2. 换手机前先备份，新手机上先部署好、打开网页、再「从备份恢复」
3. 建议把备份文件也放一份到家人的手机上

如果哪天觉得手动备份麻烦，可以进一步做成自动同步到私有仓库，但会复杂一些，先用着看。

---

## 五、关于这个工具的边界

它做的是**记录、提醒、把信息整理清楚**。

它**不做**诊断，不给用药建议。参考区间是常见成人值，不同医院仪器有差异，判断以化验单上印的为准。页面里出现的「建议联系医生」都是从常见临床红线翻译过来的提醒，不是诊断结论。

有任何拿不准的，问主治医生。

---

## 六、改起来

零构建，纯静态。改完直接 push，手机上刷新就生效（Service Worker 会在后台更新）。

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架 |
| `css/app.css` | 全部样式 |
| `js/app.js` | 所有页面与交互 |
| `js/catalog.js` | 化验项目、参考区间、症状清单、红线规则 |
| `js/plan.js` | 排期算法、ICS 导出、推送负载 |
| `js/db.js` | IndexedDB 封装 |
| `js/utils.js` | 日期、DOM、图表 |
| `scripts/push.mjs` | 云端推送逻辑 |
| `test-logic.mjs` | 排期/指标/ICS 逻辑自测（52 项） |
| `test-push.mjs` | 推送判断逻辑自测（17 项，本地假服务） |
| `test-e2e.mjs` | 浏览器端到端测试（需先起本地服务器） |

想加化验项目或症状，改 `js/catalog.js` 就行，界面会自动跟着出来。

### 跑测试

```bash
node test-logic.mjs      # 纯逻辑，不需要浏览器
node test-push.mjs       # 推送判断，自动起假 Server酱 服务

# 端到端（需要 Chrome + 本地服务器）
python -m http.server 8765
node test-e2e.mjs        # 另开一个终端
```
