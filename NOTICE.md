# Third-party notices

This package redistributes the following third-party components. Their full
license texts are included alongside the vendored sources.

## hls.js 1.6.13 (light build)

- File: `vendor/hls.light.min.js` (inlined into `client.js` at build time)
- License: Apache License 2.0
- Text: `vendor/hls.js.LICENSE`
- Upstream: <https://github.com/video-dev/hls.js>
- Copyright: Copyright (c) 2017-present, Dailymotion and contributors

Used to play the HLS (m3u8) stream of Bilibili live rooms in the browser.

## qrcode 1.5.4

- Files: `vendor/qrcode/**`
- License: MIT
- Text: `vendor/qrcode/LICENSE`
- Upstream: <https://github.com/soldair/node-qrcode>
- Copyright: Copyright (c) 2012 Ryan Day

Used on the Host side to render the login QR code as an SVG data URL, so no
Python or external binary is required.

Only the `lib/core/*` modules and the SVG renderer are vendored; unused
renderers (PNG / terminal / utf8) were removed to keep the package small.

## dijkstrajs 1.0.3

- File: `vendor/dijkstrajs/dijkstra.js`
- License: MIT
- Text: `vendor/dijkstrajs/LICENSE.md`
- Upstream: <https://github.com/tcort/dijkstrajs>
- Copyright: Copyright (C) 2008 Wyatt Baldwin

A dependency of `qrcode`'s segment optimizer. Vendored with a nested
`package.json` marking the tree as CommonJS, because this package itself is ESM.

---

# 中文说明

本插件重新分发了上面三个第三方组件，均为宽松许可证（Apache-2.0 / MIT），
完整许可证原文随源码一并提供。修改或再分发时请保留这些文件。

本插件通过哔哩哔哩的公开接口获取内容，与哔哩哔哩官方无关，仅供个人本地使用。