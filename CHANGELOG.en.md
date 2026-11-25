# Changelog

**English** · [简体中文](CHANGELOG.md)

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

---

## [0.3.4] - 2026-11-25

The background screenshot is now a **real live frame** (the previous one was patched by
painting over pixels and looked blunt).

### Documentation

- Background screenshot recaptured: the original-quality picture of
  `https://live.bilibili.com/213` while it was broadcasting, with identity redaction done
  by `redactIdentity()` at the DOM level — shown as `User` plus a neutral placeholder
  avatar, rather than painted over afterwards.
- The settings screenshot was recaptured too and stitched from segments; its account row
  shows only the signed-in state.

> Relative to 0.3.3 this only improves how the images look; the privacy handling is the same.

---

## [0.3.3] - 2026-11-25

**Privacy fix**: the published screenshots contained the user's account details.

### Fixed

- The account name and avatar in the bottom-left user button of the background
  screenshot are removed, replaced with neutral placeholder content.
- The settings screenshot's account row read `已登录 · <username>`; the username part
  is removed, leaving only the signed-in state.
- `scripts/capture-screenshots.mjs` gained `redactIdentity()`: before capturing it
  replaces the user button's text with `User`, hides the avatar, and truncates
  `已登录 · <name>` to `已登录`. **Redaction happens at the DOM level, not by painting
  over pixels afterwards** — the latter misses on a different resolution or a new
  capture.

> Screenshots published in 0.3.2 and earlier contained this information; they are
> replaced by this release. If you pulled those two images from an npm cache or an
> older tarball, update to 0.3.3.

---

## [0.3.2] - 2026-11-24

Fixes a packaging omission: the npm tarball had no screenshots while
`screenshots.json` was still shipped.

### Fixed

- `assets/screenshot-settings.png` and `assets/screenshot-background.png` are now
  included in the npm package. `files` previously listed only `assets/icon.svg`, so
  `screenshots.json` shipped but pointed at paths that did not exist — anyone
  installing from npm got a broken screenshot declaration.

> No behaviour change. Installing from GitHub was never affected: both READMEs use
> absolute `raw.githubusercontent.com` URLs, which resolve fine either way.

---

## [0.3.1] - 2026-11-24

Fixes "the sliders and switches in the settings page are the same colour as the
background, so you cannot see them"; the README screenshots are now real captures of
the running interface.

### Fixed

- **Slider fill and the switch's on-state rendered white, nearly invisible on dark
  glass.** The host resolves `--dsw-alias-brand-primary` to `#f9fafb` (white) under the
  glass theme, and the code used `var(--dsw-alias-brand-primary, #4f8cff)` — `#4f8cff`
  is only a fallback, so it never applied once the host supplied a value. Slider fill,
  switch on-state and primary buttons all turned white. The plugin now uses its own
  accent (`--bw-accent: #4f8cff`) instead of the host token.
- **The unfilled part of a slider was browser-default styling**, which disappears on a
  transparent background. The track is now drawn explicitly
  (`rgba(255,255,255,.22)` plus a border), covering both `::-webkit-slider-*` and
  `::-moz-range-*`; the thumb is a solid blue dot with a white ring and a shadow, so it
  reads on any background.
- **The switch's off-state used `rgba(128,128,128,.42)` grey**, indistinguishable from
  dark glass. It is now a visible light fill with a white outline; the on-state is blue.
- Primary buttons were white-on-white for the same host-token reason; now blue with
  white text.
- The input focus border no longer follows the host brand colour either — it uses the
  plugin accent plus a focus ring.

### Documentation

- Both README screenshots are replaced with **real captures of the running interface**:
  the original-quality stream of `https://live.bilibili.com/213`, with the title, owner
  id and three quality tiers exactly as the API returned them.
- Screenshots are now cropped to the outer card's bounding box with margin around it, so
  the rounded outline is fully visible; content that scrolls inside the settings panel
  is captured in segments and stitched together.
- Added `scripts/capture-screenshots.mjs` (drives a headless browser through the real UI)
  and `scripts/probe-room.mjs` (checks whether a given live room resolves).

### Tests

- Both scripts fail loudly instead of continuing silently; all 17 test suites still pass.

---

## [0.3.0] - 2026-11-02

Fixes "dragging the seek bar does nothing — the video never jumps".

### Fixed

- **Media played through a custom scheme, so the browser refused to seek.**
  The desktop build serves the page from `dsh-app://app`, which turned the relative
  media path `/api/bili-wallpaper/proxy…` into `dsh-app://app/api/…`. Chromium's media
  stack does not do random access over non-http(s) schemes: the video would play and
  buffer (`readyState = 4`) but `seekable` stayed `[0, 0]`, and assigning `currentTime`
  was silently ignored.
  Media URLs are now absolute `http://127.0.0.1:<port>/…` built from
  `webServer.getOrigin()`, so the `<video>` element goes through plain HTTP.
  Measured before/after: `seekable` `[0, 0]` → `[0, 3604.23]`, `currentTime = 600`
  now reads back `600.24`.
- **`/proxy` rejected non-same-origin requests.** A page served from `dsh-app://app`
  requesting `http://127.0.0.1:<port>` never matches the same-origin rule, and a
  `<video>` element cannot send the auth cookie either. The media endpoint now only
  requires a loopback `Host`; its real boundary stays the HMAC signature plus the
  Bilibili CDN host allowlist (both still enforced and tested).
- **Missing CORS headers on the media endpoint.** Added `Access-Control-Allow-Origin`,
  `Allow-Headers: range,if-range` and `Expose-Headers: content-range,content-length,accept-ranges`,
  plus an `OPTIONS` preflight reply.

### Added

- **`HEAD` support on `/proxy`.** Browsers often probe a media resource with `HEAD`
  before playing. Only `GET` was routed, so `HEAD` fell through to `404` and the
  browser concluded the resource was not randomly accessible. `HEAD` now returns the
  full headers (`Content-Length`, `Accept-Ranges`, `Content-Type`) with no body.
- **`Content-Length` backfill.** When the CDN answers a range request with chunked
  transfer (no `Content-Length`), the proxy now derives the length from
  `Content-Range` (`bytes a-b/total` → `b-a+1`). Large stream recordings hit this path.

### Changed

- Range-related upstream statuses (`401`, `403`, `404`, `405`, `416`, `429`) are now
  passed through unchanged instead of being collapsed into `502`. In particular `416`
  is a normal answer to an out-of-range probe, and wrapping it in `502` made Chrome
  treat the whole media as unseekable.

### Tests

- `test/test-absolute-media-url.mjs`: media URL shape, cross-origin range access,
  `HEAD`, and that a tampered signature / non-allowlisted host is still rejected.
- `test/test-head-request.mjs`, `test/test-416-passthrough.mjs`,
  `test/test-content-length.mjs`: the three transport fixes above.

---

## [0.2.2] - 2026-11-02

Fixes "releasing the seek bar snaps it back to the beginning".

### Fixed

- **Seek bar snapped back on release**: the local drag value `__seek` was deleted the
  moment the pointer was released, so the slider `value` fell back to
  `snap.position.at`. Seeking is asynchronous (`currentTime` → `seeking` → `seeked` →
  `timeupdate`), so at that instant `at` was still the old value and the thumb jumped
  back. The drag value is now **kept** until the `seeked` event reports the real
  position, with a 1.5 s fallback for the case where `seeked` never fires (seeking to
  the current position).
- **Seek bar stuck at the old position after switching parts**: the local drag state
  was not reset when the source changed, so the slider for the new part sat at the
  previous part's position. `refresh` now notifies the UI whenever the media changes.

### Tests

- `test/test-seek-ui.mjs`: seek-bar state machine, including a control case for the old
  defective behaviour plus the fallback and part-switch reset scenarios.
- `test/test-seek-e2e.mjs`: real Host + real client; verifies the position after seek,
  that the video is not rebuilt, and that it keeps playing.

---

## [0.2.1] - 2026-11-02

Fixes "selected 'play next part' but it replays the current one".

### Fixed

- **The `next` branch refreshed twice**: `patch({page})` already `await`s
  `refresh(true)`, and the handler awaited it again, tearing down and rebuilding the
  `<video>` twice in a row. The freshly started part was interrupted, which looked like
  "back to the start of the current part". The source is now swapped exactly once.
- **Progress leaked between parts**: after a switch the old `<video>` still fired
  occasional `pause` / `timeupdate` events, and `flushProgress` read the *current*
  media, so the previous part's seconds were written onto the new part's record.
  Progress reports now carry their own `media.url` / `page` / `bvid` and are dropped
  when the identity does not match.

### Improved

- The media card explicitly shows **`P2/11 · part title`**. Neighbouring parts of a long
  stream recording look nearly identical, so previously there was no way to tell whether
  the switch actually happened.
- The end-of-part notice now reads `finished P1 → playing P2 · title`, stating which part
  it moved from and to.

### Tests

- `test/test-next-part.mjs`: end-to-end assertion that one `ended` event creates exactly
  **1** new `<video>` — a direct probe for the original defect — plus checks that the new
  source is playing, the backend page switched, and the finished part's progress was cleared.

---

## [0.2.0] - 2026-11-02

Videos no longer only "loop part 1 forever" — you can now play the next part, seek, and
resume where you left off.

### Added

- **End-of-video behaviour** (Settings → B站背景 → Playback → When it ends), one of four:
  - `play the next part; stop at the last one` (default)
  - `loop this part`
  - `stop on the last frame`
  - `turn the background off`
- **Part switching**: multi-part videos get a dropdown plus previous / next buttons.
- **Seek bar**: drag to any point in a video, with a live `current / total` readout.
- **Resume**: reopening the same video (same part) continues from the last position.
  - Stored per "video + part", so part 1 and part 2 never overwrite each other.
  - Finishing a part **clears** that part's position, otherwise the next open would
    resume at the very end.
  - Does not resume when less than 15 seconds (or 2%) remain, so a video does not open
    already finished.
- Host gained a `GET/POST /api/bili-wallpaper/progress` route; positions live in
  `$DSH_HOME/bili-wallpaper/progress.json`.
- `resolve` now returns `parts[]` (the part list) and `totalDuration`.

### Changed

- `video.loop` is no longer unconditionally `true`; it is decided by `endAction`.
- New config keys `page` / `endAction` / `resume`; `configVersion` bumped to 3.
- For single-part videos `duration` is now that part's duration, with `totalDuration`
  giving the whole video's length.

### Fixed

- Corrected the wording "videos split into several segments only *loop* the first one" —
  they only *play* the first segment, there is no looping.

### Tests

- `test/test-playback.mjs`: hits the real API to verify the part list (11 parts), that
  the cid changes when switching parts, progress read/write/clear, and per-part key
  isolation.
- `test/test-end-decision.mjs`: pure-function tests for the four end actions, which also
  assert that **the shipped implementation stays structurally in sync with the test**.
- Removed two fake-DOM end-to-end tests: timer simulation caused infinite recursion in
  the store and they could not catch real problems.

---

## [0.1.3] - 2026-11-02

Fixes the **real** root cause of the `-351` risk-control errors.

### Fixed

- **Signed-in requests no longer send `buvid3`.** Measured: `SESSDATA + buvid3` together
  is treated by Bilibili as "same account + unfamiliar device fingerprint" and `playurl`
  returns `-351` immediately; dropping `buvid3` from the very same request yields
  `code=0`. `SESSDATA` alone, `SESSDATA+bili_jct` and `SESSDATA+DedeUserID` are all fine.
- Anonymous requests still send `buvid3` (there it is a net positive).

### Documentation

- The `-351` troubleshooting order in the README changed to: **try signing out first** —
  when an account is flagged, anonymous access often works.

### Tests

- `test/test-cookie-composition.mjs`: fails immediately if anyone adds `buvid3` back into
  a signed-in request.

---

## [0.1.2] - 2026-11-02

Started addressing `-351` (the diagnosis was still incomplete; 0.1.3 found the root cause).

### Added

- **Automatic backoff for risk-control codes**: `-351` / `-352` / `-412` / `-509` are
  retried three times at 0.6s → 1.6s → 3.2s; network hiccups are retried too.
- **Readable error messages**: risk-control failures no longer surface as a raw
  "B站接口 -351：…" but explain that this is risk control and what to do about it.
  The `/resolve` response gained `code` / `risk` fields.
- Anonymous requests send a `buvid3` device fingerprint (from `finger/spi`, cached
  in-process).

### Fixed

- Requests were previously sent bare when signed out (believed at the time to be the main
  cause of `-351`).

### Tests

- `test/test-risk-351.mjs`: forces `-351` through mocked responses and verifies the retry
  count, backoff delay, the `risk` flag and message text, and automatic recovery on the
  third attempt.
- `test/test-anon-buvid3.mjs`: verifies anonymous requests really do carry `buvid3` and do
  not accidentally carry `SESSDATA`.

---

## [0.1.1] - 2026-10-29

First release on npm and GitHub.

### Added

- Live background: a live-room URL or room id; the live picture fills the area behind the chat.
- Video background: video URLs, `BV` ids, `av` ids, `b23.tv` short links.
- Scan login: the QR code is rendered in the settings page; signing in unlocks the
  original quality tier for live streams.
- Quality picker: live uses `g_qn_desc`, video uses `accept_quality`.
- Picture controls: cover/contain, background blur, darkening scrim, panel opacity,
  mute / volume / playback rate.
- Automatic pause when the window is hidden.
- Translucent UI: panels, sidebar and bubbles turn into glass surfaces that let the
  picture through.
- Self-healing live: when the stream URL expires, or the host goes offline and returns,
  the plugin re-resolves automatically.
- Host-side media proxy: `Referer` to bypass hotlink protection, HLS playlist rewriting,
  `HMAC-SHA256` signing, and a Bilibili CDN host allowlist.

### Fixed (relative to the unreleased 0.1.0)

- **Live streams had no sound because of an out-of-the-box mute**: 0.1.0 defaulted to
  `muted: true` and hid the volume slider entirely while muted, so users could neither
  hear anything nor find a switch. Now the plugin is unmuted by default with the volume
  slider always visible, and a `configVersion` migration flips the "not actually chosen
  by the user" mute in old configs exactly once.
- Live prefers **ts** over fmp4: the AAC track is muxed into the ts segments, so audio and
  video stay in sync naturally (measured `Audio: aac (LC), 48000 Hz, stereo`).
- When the browser blocks autoplay: start muted, show an "turn sound on" hint in the page,
  and restore sound on one click — no more silent muting behind the user's back.

[Unreleased]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.4...HEAD
[0.3.4]: https://github.com/st21a1/dsh-bili-wallpaper/compare/v0.3.3...v0.3.4
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