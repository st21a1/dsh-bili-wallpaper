# Changelog

本项目的所有重要变更都记录在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

暂无。

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

[Unreleased]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/st21a1/dsh-bili-wallpaper/releases/tag/v0.1.1