# Changelog

[English](CHANGELOG.en.md) · **简体中文**

本项目的所有重要变更都记录在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

暂无。

---

## [0.3.3] - 2026-11-25

**隐私修复**：已发布的截图里含使用者的账号信息。

### 修复

- 背景截图左下角用户按钮里的 **账号名与头像** 已抹除，
  由中性的占位内容替代。
- 设置页截图「账号」行原本写着 `已登录 · <用户名>`，
  用户名部分已抹除，只保留「已登录」。
- `scripts/capture-screenshots.mjs` 增加 `redactIdentity()`：
  截图前在页面上把用户按钮文字换成 `User`、隐藏头像，
  并把「已登录 · 用户名」截断成「已登录」。
  **打码在 DOM 层完成，而不是事后涂改像素** —— 后者换个分辨率或换张图就会漏。

> 0.3.2 及更早版本发布过的截图包含这些信息，已在本次替换。
> 若你从 npm 缓存或旧 tarball 取过那两张图，请更新到 0.3.3。

---

## [0.3.2] - 2026-11-24

补上一个发布遗漏：npm 包里没有截图，但 `screenshots.json` 在包内。

### 修复

- `assets/screenshot-settings.png` 与 `assets/screenshot-background.png`
  现在包含在 npm 包中。此前 `files` 只收录了 `assets/icon.svg`，
  而 `screenshots.json` 照常打进包却指向不存在的路径 —— 从 npm 装的用户
  看到的截图声明是坏的。

> 功能无变化。只用 GitHub 安装的用户不受影响，那两份 README 引用的是
> `raw.githubusercontent.com` 绝对地址，本来就能正常显示。

---

## [0.3.1] - 2026-11-24

修掉「设置页的滑条和开关与背景同色，看不见」；README 截图换成真实运行界面。

### 修复

- **滑条填充与开关开启态变成白色，压在深色玻璃上几乎不可见。**
  根因是宿主在玻璃主题下把 `--dsw-alias-brand-primary` 解析成 `#f9fafb`（白色），
  而代码写的是 `var(--dsw-alias-brand-primary, #4f8cff)` —— `#4f8cff` 只是
  fallback，宿主给了值就不生效。于是滑条已填充段、开关开启态、主按钮全变白。
  现在改用插件自己的一组强调色（`--bw-accent: #4f8cff`），不再依赖宿主令牌。
- **滑条未填充的轨道是浏览器默认样式**，在透明背景上等于消失。
  现在显式绘制轨道（`rgba(255,255,255,.22)` + 描边），
  `::-webkit-slider-*` 与 `::-moz-range-*` 两套都覆盖，
  拇指改为蓝色实心 + 白色描边 + 投影，任何背景上都看得清。
- **开关关闭态用 `rgba(128,128,128,.42)` 灰**，叠在深色玻璃上像没渲染。
  改为可见的浅灰底 + 白色描边勾出轮廓；开启态用蓝色。
- 主按钮此前是白底白字（同样因为跟随宿主 brand 色），改为蓝底白字。
- 输入框聚焦边框也不再跟随宿主 brand 色，改用自定义强调色 + 焦点环。

### 文档

- README 的两张截图更换为**真实运行界面截图**：
  直播间 `https://live.bilibili.com/213` 的原画画面，
  面板上的标题、UP 主 ID、三档清晰度均为接口真实返回。
- 截图改为按外层卡片包围盒裁切并留出边缘，能看清完整圆角轮廓；
  设置面板内部滚动的内容通过分段截图拼接完整呈现。
- 新增 `scripts/capture-screenshots.mjs`（驱动无头浏览器走真实 UI 截图）
  与 `scripts/probe-room.mjs`（验证某个直播间能否解析）。

### 测试

- 两个脚本都补了失败即退出的错误处理；17 个测试套件保持通过。

---

## [0.3.0] - 2026-11-02

修掉「拖进度条完全没反应，视频不跳」。

### 修复

- **媒体走了自定义协议，浏览器因此拒绝随机访问。** 桌面版页面源是
  `dsh-app://app`，相对路径 `/api/bili-wallpaper/proxy…` 被解析成
  `dsh-app://app/api/…`。Chromium 的媒体栈对非 http(s) scheme 不做随机访问：
  视频能播、能缓冲（`readyState = 4`），但 `seekable` 恒为 `[0, 0]`，
  给 `currentTime` 赋值被静默忽略。
  现在媒体地址改为用 `webServer.getOrigin()` 拼出的绝对 `http://127.0.0.1:<port>/…`，
  `<video>` 走标准 HTTP。实测前后对比：`seekable` `[0, 0]` → `[0, 3604.23]`，
  `currentTime = 600` 能读回 `600.24`。
- **`/proxy` 拒绝非同源请求。** 源为 `dsh-app://app` 的页面请求
  `http://127.0.0.1:<port>` 永远不满足同源规则，而 `<video>` 又无法携带认证
  cookie。媒体端点现在只要求 `Host` 是回环地址；真正的边界仍是 HMAC 签名 +
  B 站 CDN 域名白名单（两者都保留且仍有测试覆盖）。
- **媒体端点缺 CORS 头。** 补上 `Access-Control-Allow-Origin`、
  `Allow-Headers: range,if-range`、`Expose-Headers: content-range,content-length,accept-ranges`，
  以及 `OPTIONS` 预检应答。

### 新增

- **`/proxy` 支持 `HEAD`。** 浏览器播放前常先用 `HEAD` 探测媒体资源。之前只路由
  `GET`，`HEAD` 落到 `404`，浏览器据此判定资源不可随机访问。现在 `HEAD`
  返回完整头（`Content-Length`、`Accept-Ranges`、`Content-Type`）且不带 body。
- **`Content-Length` 回填。** 当 CDN 用分块传输（无 `Content-Length`）应答
  Range 请求时，代理从 `Content-Range`（`bytes a-b/total` → `b-a+1`）推算出长度。
  大体积录播会走到这条路径。

### 变更

- Range 相关的上游状态码（`401`、`403`、`404`、`405`、`416`、`429`）改为**原样透传**，
  不再一律折叠成 `502`。尤其是 `416`——它是越界探测的正常答复，裹成 `502`
  会让 Chrome 认为整个媒体不可 seek。

### 测试

- `test/test-absolute-media-url.mjs`：媒体地址形态、跨源 Range 访问、`HEAD`，
  以及篡改签名 / 非白名单域名仍被拒绝。
- `test/test-head-request.mjs`、`test/test-416-passthrough.mjs`、
  `test/test-content-length.mjs`：上面三项传输层修复。

---

## [0.2.2] - 2026-11-02

修掉「拖动进度条松手后弹回开场」。

### 修复

- **进度条松手即弹回**：松手时立刻删掉本地拖动值 `__seek`，滑块 `value` 回落到
  `snap.position.at`。但 `seek` 是异步的（`currentTime` → `seeking` → `seeked` →
  `timeupdate`），那一刻 `at` 仍是旧值，于是滑块弹回原位置。
  现在松手后**保留** `__seek`，等 `seeked` 事件回报真实位置再清理；
  另有 1.5s 兜底，防止 `seeked` 不触发（目标位置与当前相同时会这样）导致滑块卡住。
- **切P 后滑块卡在旧位置**：换源时本地拖动态没有重置，新片段的滑块会停在上一P 拖到的位置。
  现在 `refresh` 检测到 media 变化就通知 UI 清空。

### 测试

- `test/test-seek-ui.mjs`：进度条状态机测试，含旧实现的缺陷对照，以及兜底与切P 重置场景。
- `test/test-seek-e2e.mjs`：真 Host + 真 client，验证 seek 后位置正确、不重建 video、仍在播放。

---

## [0.2.1] - 2026-11-02

修掉「选了播下一P，实际却在重播当前P」。

### 修复

- **`next` 分支重复 refresh**：`patch({page})` 内部已经 `await refresh(true)`，
  之后又 `await refresh(true)` 了一次，导致连续两次拆掉并重建 `<video>`，
  刚启动的新P 播放被打断，观感上就是「回到当前P 开头」。现在只换源一次。
- **切P 时进度串台**：切P 后旧 `<video>` 仍会零星触发 `pause` / `timeupdate`，
  而 `flushProgress` 读的是「当前 media」，于是旧P 的秒数被写进了新P 的进度记录。
  现在进度上报会带上自己所属的 `media.url` / `page` / `bvid`，身份不一致直接丢弃。

### 改进

- 媒体卡片显式显示 **`P2/11 · 分P标题`**。多P 录播相邻两P 的画面往往几乎一样，
  以前没有任何地方能确认「到底切没切」，现在一眼可见。
- 播完切P 的提示改为 `播完 P1 → 接着播 P2 · 标题`，写明从哪一P 到哪一P。

### 测试

- `test/test-next-part.mjs`：端到端断言「触发一次 `ended` 只新建 **1** 个 `<video>`」，
  这正是原缺陷的直接探针；同时检查新源已播放、后端 page 已切、播完的P 进度被清除。

---

## [0.2.0] - 2026-11-02

视频不再只会「无限循环第一P」——现在可以播下一P、拖进度、接着上次看。

### 新增

- **播完之后的行为**（设置 → B站背景 → 播放 → 播完之后），四选一：
  - `播下一P，最后一P停住`（默认）
  - `重头循环（同一P）`
  - `停在最后一帧`
  - `关闭背景`
- **分P 切换**：多P 视频有下拉选择框，外加「上一P / 下一P」按钮。
- **进度条**：视频可拖动跳到任意时间点，实时显示 `当前 / 总时长`。
- **记住进度**：再打开同一个视频（同一P）从上次位置继续。
  - 按「视频 + 分P」分别保存，单P 与 P2 互不覆盖。
  - 某一P播完会**自动清掉**该P的进度，否则下次打开会「续播」到片尾。
  - 剩不到 15 秒（或 2%）时不续播，避免一打开就结束。
- Host 新增 `GET/POST /api/bili-wallpaper/progress` 路由，进度存在
  `$DSH_HOME/bili-wallpaper/progress.json`。
- `resolve` 返回值新增 `parts[]`（分P 列表）与 `totalDuration`。

### 变更

- `video.loop` 不再无条件为 `true`，改由 `endAction` 决定。
- 配置新增 `page` / `endAction` / `resume`，`configVersion` 升至 3。
- 单P 视频的 `duration` 现在取该P时长，另给 `totalDuration` 表示全视频总时长。

### 修复

- 修正「分多段的视频只循环第一段」的措辞——实际情况是只播放第一段，不是循环。

### 测试

- `test/test-playback.mjs`：打真实接口验证 parts 列表（11 个分P）、切P 后 cid 变化、
  进度读写与清除、单P/P2 键隔离。
- `test/test-end-decision.mjs`：四种播完动作的纯函数测试，并断言**源码实现与测试同构**，
  防止改了实现却忘了改测试。
- 移除两个基于假 DOM 的端到端测试：定时器模拟导致 store 无限递归，测不出真问题。

---

## [0.1.3] - 2026-11-02

修掉 `-351` 风控的**真正**根因。

### 修复

- **登录态不再发送 `buvid3`**。实测：`SESSDATA + buvid3` 同时出现会被 B 站判为
  「同一账号 + 陌生设备指纹」，`playurl` 直接返回 `-351`；同一次请求去掉 `buvid3`
  立刻 `code=0`。`SESSDATA` 单独、`SESSDATA+bili_jct`、`SESSDATA+DedeUserID` 都正常。
- 匿名请求仍然带 `buvid3`（在那里它是加分项）。

### 文档

- README 的 `-351` 排查顺序改为：**先退出登录试**——账号被风控时匿名反而能通。

### 测试

- `test/test-cookie-composition.mjs`：一旦有人在登录请求里加回 `buvid3`，测试立刻失败。

---

## [0.1.2] - 2026-11-02

开始着手处理 `-351`（此时判断还不完整，0.1.3 才找到根因）。

### 新增

- **风控码自动退避重试**：`-351` / `-352` / `-412` / `-509` 按 0.6s → 1.6s → 3.2s
  重试 3 次；网络抖动也会重试。
- **可读的错误提示**：风控失败不再原样抛出「B站接口 -351：…」，而是说明这是风控、
  以及可以怎么做。`/resolve` 响应新增 `code` / `risk` 字段。
- 匿名请求带 `buvid3` 设备指纹（来自 `finger/spi`，进程内缓存）。

### 修复

- 未登录时裸奔发请求的问题（当时认为这是 `-351` 的主因）。

### 测试

- `test/test-risk-351.mjs`：用模拟响应强制触发 `-351`，验证重试次数、退避等待、
  `risk` 标记与提示文案，以及「两次风控后第三次成功自动恢复」。
- `test/test-anon-buvid3.mjs`：验证匿名请求确实带上 `buvid3`、且不误带 `SESSDATA`。

---

## [0.1.1] - 2026-10-29

首次发布到 npm 与 GitHub。

### 新增

- 直播背景：直播间链接或房号，实时画面铺在聊天背后。
- 视频背景：视频链接、`BV` 号、`av` 号、`b23.tv` 短链。
- 扫码登录：二维码直接画在设置页，登录后直播可选「原画」。
- 清晰度选择：直播取 `g_qn_desc`，视频取 `accept_quality`。
- 画面调节：铺满/完整、背景模糊、压暗遮罩、面板不透明度、静音/音量/播放速度。
- 切到后台自动暂停。
- 半透明 UI：面板、侧栏、气泡变成能透出画面的玻璃面。
- 开播自愈：直播地址过期或主播下播后重开，会自动重新解析。
- Host 端媒体代理：带 `Referer` 绕过防盗链、改写 HLS 清单、`HMAC-SHA256` 签名、
  B 站 CDN 域名白名单。

### 修复（相对 0.1.0 未发布版本）

- **出厂静音导致直播没声音**：0.1.0 默认 `muted: true` 且静音时把音量滑条整个隐藏，
  用户既听不到声音也找不到开关。改为默认出声 + 音量滑条常驻，并按 `configVersion`
  把旧配置里那条「不是用户选的静音」一次性翻过来。
- 直播优先选 **ts** 而不是 fmp4：AAC 音轨直接混在 ts 分片里，音画天然同步
  （实测 `Audio: aac (LC), 48000 Hz, stereo`）。
- 浏览器拦截自动播放时：先静音放起来并在页面提示「打开声音」，点一下即恢复，
  不再悄悄静音。

[Unreleased]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/st21a1/dsh-bili-wallpaper/releases/tag/v0.1.1