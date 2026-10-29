/**
 * dsh-bili-wallpaper —— 浏览器半端
 * ============================================================================
 * 自注册脚本（约定见官方装饰模板 / dsh-bili-scroll）：
 *     window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... } })
 *
 * 两件事：
 *   ① 在 body 后面挂两层：整屏视频层（z-index:-2）与遮罩层（z-index:-1），
 *      再把外壳（页面基色 / 侧栏填充 / 面板令牌）改成半透明，于是聊天窗口背后就是直播 / 视频。
 *   ② 在「设置」里加一页：开关、来源、清晰度、画面、扫码登录。
 *
 * Host 半端（index.js）负责解析地址、取流、代理媒体、存配置；
 * 页与层共用同一个 store，所以设置页一改，背景立刻跟着换。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-wallpaper',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/api/bili-wallpaper'
    const TAG = 'dsh-bili-wallpaper'
    const LAYER_ID = 'bw-layer'
    const SCRIM_ID = 'bw-scrim'
    const ACTIVE_ATTR = 'data-bw-wallpaper'

    /* ══ 文案 ══════════════════════════════════════════════════════════════ */
    const COPY = {
      zh: {
        nav: 'B站背景',
        title: 'B站动态背景',
        lead: '把 B 站直播间或视频放到聊天窗口背后。扫码登录自己的账号后能选到原画。',
        on: '开启背景',
        onHint: '关掉就恢复宿主原生外观，媒体也会停止加载。',
        source: '来源',
        sourceHint: '直播间链接 / 直播间号，或者视频链接 / BV 号 / av 号；b23.tv 短链也认。',
        sourcePlaceholder: 'https://live.bilibili.com/6   或   BV1xx411c7mD',
        apply: '使用这个来源',
        clear: '清除',
        quality: '清晰度',
        auto: '自动（能拿到的最好一档）',
        look: '画面',
        fit: '填充方式',
        fitCover: '铺满（裁边）',
        fitContain: '完整（留边）',
        blur: '背景模糊',
        scrim: '压暗遮罩',
        surface: '面板不透明度',
        mute: '静音',
        volume: '音量',
        rate: '播放速度',
        pauseHidden: '切到后台时暂停',
        account: '账号',
        loggedIn: '已登录',
        loggedOut: '未登录',
        login: '扫码登录',
        logout: '退出登录',
        scanning: '手机 B站 → 我的 → 扫一扫；确认时选「记住我」那种长期登录。',
        waiting: '等你扫码…',
        scanned: '扫到了，在手机上点确认',
        expired: '二维码过期了，重新点「扫码登录」',
        needLogin: '不登录也能放，但直播通常只给到「超清」；登录后可选原画。',
        conflict: '检测到「壁纸引擎」也在画背景层 —— 两层都是整屏的，建议只开一个（把另一个关掉或清空它的壁纸）。',
        audioBlocked: '浏览器拦住了带声音的自动播放，现在是静音在放。点一下打开声音。',
        soundOn: '打开声音',
        none: '还没有来源：粘一个直播或视频地址试试。',
        live: '直播',
        video: '视频',
        offline: '没开播',
        retry: '刷新',
        loading: '解析中…',
        saved: '已保存',
        error: '出错',
      },
      en: {
        nav: 'Bilibili BG',
        title: 'Bilibili Wallpaper',
        lead: 'Play a Bilibili live room or video behind the chat. Scan-login with your own account to unlock the original tier.',
        on: 'Enable background',
        onHint: 'Turning this off restores the stock look and stops loading media.',
        source: 'Source',
        sourceHint: 'A live-room link or room id, or a video link / BV id / av id; b23.tv short links work too.',
        sourcePlaceholder: 'https://live.bilibili.com/6   or   BV1xx411c7mD',
        apply: 'Use this source',
        clear: 'Clear',
        quality: 'Quality',
        auto: 'Auto (best available)',
        look: 'Picture',
        fit: 'Fit',
        fitCover: 'Cover (crop)',
        fitContain: 'Contain (letterbox)',
        blur: 'Background blur',
        scrim: 'Darkening scrim',
        surface: 'Panel opacity',
        mute: 'Mute',
        volume: 'Volume',
        rate: 'Playback rate',
        pauseHidden: 'Pause when hidden',
        account: 'Account',
        loggedIn: 'Signed in',
        loggedOut: 'Not signed in',
        login: 'Scan to sign in',
        logout: 'Sign out',
        scanning: 'Bilibili app → Me → Scan. Choose the long-lived "remember me" option when confirming.',
        waiting: 'Waiting for the scan…',
        scanned: 'Scanned — confirm on your phone',
        expired: 'The QR code expired; press "Scan to sign in" again',
        needLogin: 'Playback works signed out, but live is usually limited to "Ultra HD"; signing in unlocks the original tier.',
        conflict: 'Wallpaper Engine is also drawing a background layer; both are full-screen, so keep only one of them on.',
        audioBlocked: 'The browser blocked autoplay with sound, so it is playing muted. Click to turn the sound on.',
        soundOn: 'Turn sound on',
        none: 'No source yet — paste a live-room or video URL.',
        live: 'Live',
        video: 'Video',
        offline: 'Offline',
        retry: 'Refresh',
        loading: 'Resolving…',
        saved: 'Saved',
        error: 'Error',
      },
    }

    /* ══ 样式 ══════════════════════════════════════════════════════════════ */

    const CSS = `
/* ── 媒体层：整屏，压在最底 ── */
#${LAYER_ID} {
  position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none;
  opacity: 0; transition: opacity .5s ease; background: transparent;
  -webkit-app-region: initial !important;
}
#${LAYER_ID}[data-on] { opacity: 1; }
#${LAYER_ID} > video, #${LAYER_ID} > img.bw-poster {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  object-fit: cover; background: #05070b;
}
#${LAYER_ID}[data-fit="contain"] > video,
#${LAYER_ID}[data-fit="contain"] > img.bw-poster { object-fit: contain; }
#${LAYER_ID} > video {
  filter: blur(var(--bw-blur, 0px));
  transform: scale(var(--bw-blur-scale, 1));
}
#${LAYER_ID} > img.bw-poster {
  filter: blur(var(--bw-blur, 0px)) brightness(.65);
  transition: opacity .6s ease;
}

/* ── 遮罩：压在媒体上、UI 下 ── */
#${SCRIM_ID} {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: rgba(0, 0, 0, var(--bw-scrim, .45));
  -webkit-app-region: initial !important;
}

/* ── 外壳让开：令牌换半透明面板色，外层框架透明 ──
   （只覆盖宿主自己声明的别名词，不碰第三方插件子树）
   ⚠️ 选择器要够重：暗色主题下宿主与「壁纸引擎」都会写
   body[data-ds-dark-theme]（0,1,1）甚至 body[data-ds-dark-theme][data-we-glass-page]（0,2,1），
   只写 body[data-bw-wallpaper]（0,1,1）会在样式表顺序上输掉 ⇒ 面板又变回实心。
   下面一律叠到 (0,2,1) 以上，并保留 !important 兜住内联/后置样式。 */
body[${ACTIVE_ATTR}],
body[data-ds-dark-theme][${ACTIVE_ATTR}] {
  /* !important：宿主的主题调色板 / 壁纸引擎的玻璃页面规则都是后挂的插件样式表，
     光靠选择器顺序赢不了，令牌必须显式压住 */
  --dsw-alias-bg-base: transparent !important;
  --dsw-specific-sidebar-fill: transparent !important;
  --dsw-alias-bg-layer-1: rgba(var(--bw-surface-rgb, 13, 21, 36), var(--bw-surface-alpha, .72)) !important;
  --dsw-alias-bg-layer-2: rgba(var(--bw-surface-rgb, 13, 21, 36), var(--bw-surface-alpha, .72)) !important;
  --dsw-alias-bg-layer-3: rgba(var(--bw-surface-rgb, 13, 21, 36), calc(var(--bw-surface-alpha, .72) + .12)) !important;
  --dsw-alias-bg-overlay: rgba(var(--bw-surface-rgb, 13, 21, 36), calc(var(--bw-surface-alpha, .72) + .12)) !important;
  --dsw-alias-bg-module-platform: rgba(var(--bw-surface-rgb, 13, 21, 36), var(--bw-surface-alpha, .72)) !important;
  --dsw-alias-bg-multi-select: rgba(var(--bw-surface-rgb, 13, 21, 36), var(--bw-surface-alpha, .72)) !important;
  --dsw-alias-button-elevated-fill: rgba(var(--bw-surface-rgb, 13, 21, 36), calc(var(--bw-surface-alpha, .72) + .1)) !important;
  --dsw-alias-button-tool-bar-fill: rgba(var(--bw-surface-rgb, 13, 21, 36), var(--bw-surface-alpha, .72)) !important;
  --dsw-alias-button-floating-fill: rgba(var(--bw-surface-rgb, 13, 21, 36), calc(var(--bw-surface-alpha, .72) + .08)) !important;
  background-color: transparent;
}
body[${ACTIVE_ATTR}] > #root,
body[${ACTIVE_ATTR}] > #root > [class*="_frame"],
body[${ACTIVE_ATTR}] > #root > [class*="_frame"] > [class*="_root"],
body[data-ds-dark-theme][${ACTIVE_ATTR}] > #root,
body[data-ds-dark-theme][${ACTIVE_ATTR}] > #root > [class*="_frame"],
body[data-ds-dark-theme][${ACTIVE_ATTR}] > #root > [class*="_frame"] > [class*="_root"],
body[${ACTIVE_ATTR}] .dshDesktopFrame { background-color: transparent !important; }

/* ── 设置页 ── */
[data-bw-page] { display: flex; flex-direction: column; gap: 18px; padding: 2px 2px 10px; max-width: 680px; }
[data-bw-h1] { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary, inherit); }
[data-bw-lead] { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, inherit); margin: 0; }
[data-bw-sec] { display: flex; flex-direction: column; gap: 9px; }
[data-bw-h] { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.9)); }
[data-bw-row] { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-bw-label] { font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
[data-bw-note] { font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-tertiary, rgba(128,128,128,.9)); }
[data-bw-card] { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
[data-bw-input], [data-bw-select] {
  box-sizing: border-box; padding: 7px 9px; border-radius: 8px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.1));
  color: var(--dsw-alias-label-primary, inherit); font-family: inherit;
}
[data-bw-input] { flex: 1; min-width: 0; }
[data-bw-select] { min-width: 168px; }
[data-bw-input]:focus, [data-bw-select]:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4f8cff); }
[data-bw-btn] {
  padding: 7px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.24));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.12));
  color: var(--dsw-alias-label-primary, inherit);
}
[data-bw-btn]:hover:not([disabled]) { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.22)); }
[data-bw-btn][data-primary] {
  background: var(--dsw-alias-brand-primary, #4f8cff); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
[data-bw-btn][disabled] { opacity: .5; cursor: default; }
[data-bw-sw] { flex: none; width: 38px; height: 22px; border-radius: 11px; border: 0; cursor: pointer; position: relative;
  padding: 0; background: rgba(128,128,128,.42); transition: background .15s; }
[data-bw-sw][data-on] { background: var(--dsw-alias-brand-primary, #4f8cff); }
[data-bw-sw] i { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; display: block; transition: left .15s; }
[data-bw-sw][data-on] i { left: 19px; }
[data-bw-slider] { flex: 1; min-width: 120px; accent-color: var(--dsw-alias-brand-primary, #4f8cff); }
[data-bw-val] { font-size: 11px; min-width: 44px; text-align: right; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, inherit); }
[data-bw-msg] { font-size: 11px; line-height: 17px; padding: 7px 9px; border-radius: 8px; word-break: break-word;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.12));
  color: var(--dsw-alias-label-secondary, inherit); }
[data-bw-msg][data-tone="good"] { color: var(--dsw-alias-state-success-primary, #22c55e); }
[data-bw-msg][data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #f59e0b); }
[data-bw-msg][data-tone="bad"] { color: var(--dsw-alias-state-error-primary, #ef4444); }
[data-bw-audiobar] { display: flex; align-items: center; gap: 10px; }
[data-bw-qr] { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
[data-bw-qr] img { width: 148px; height: 148px; border-radius: 8px; background: #fff; padding: 6px; display: block; }
[data-bw-avatar] { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: rgba(128,128,128,.2); }
[data-bw-meta] { display: flex; gap: 12px; align-items: flex-start; }
[data-bw-thumb] { width: 132px; aspect-ratio: 16/9; border-radius: 8px; object-fit: cover; flex: none;
  background: rgba(128,128,128,.16); }
[data-bw-kv] { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
[data-bw-strong] { font-size: 13px; line-height: 18px; font-weight: 600; word-break: break-word;
  color: var(--dsw-alias-label-primary, inherit); }
[data-bw-tag] { font-size: 10px; padding: 1px 6px; border-radius: 999px; margin-right: 5px; vertical-align: middle;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3));
  color: var(--dsw-alias-label-tertiary, inherit); }
    `

    /* ══ 小工具 ════════════════════════════════════════════════════════════ */

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
    const pct = (v) => Math.round(Number(v) * 100) + '%'

    const DEFAULT_CFG = {
      enabled: false,
      source: '',
      quality: 0,
      fit: 'cover',
      blur: 0,
      scrim: 0.45,
      surface: 0.72,
      // 默认出声：背景也是画面的一部分，静音应该是用户主动选的，不该是出厂状态
      muted: false,
      volume: 0.6,
      playbackRate: 1,
      pauseOnHidden: true,
    }

    async function api(path, options) {
      const res = await fetch(API + path, {
        credentials: 'same-origin',
        ...options,
        headers: options && options.body ? { 'content-type': 'application/json' } : undefined,
      })
      let body = {}
      try {
        body = await res.json()
      } catch {
        /* 空体 */
      }
      if (!res.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + res.status)
      return body
    }

    /* hls.js：直播的 m3u8 用它放（构建期内联在下面） */
    const HlsCtor = (() => {
      const root = typeof globalThis !== 'undefined' ? globalThis : window
      const prev = root.Hls
      let lib = null
      try {
        /*__HLS_INLINE__*/
        lib = root.Hls || null
      } catch (err) {
        console.error('[bili-wallpaper] hls.js 初始化失败：', err)
      }
      try {
        if (prev === undefined) delete root.Hls
        else root.Hls = prev
      } catch {
        /* 删不掉也无所谓 */
      }
      return lib
    })()

    /* ══ 媒体层 ════════════════════════════════════════════════════════════ */

    function createLayer() {
      let layer = null
      let scrim = null
      let video = null
      let poster = null
      let hls = null
      let yielded = []
      let htmlBg = null
      let htmlFilter = null
      let disposed = false
      let resumeOnGesture = null
      let lastMedia = null
      let lastCfg = null
      let onFatal = null
      let onBlocked = null

      const ready = () => document.body && document.documentElement

      const ensureNodes = () => {
        if (disposed || !ready()) return false
        if (!layer || !layer.isConnected) {
          layer = document.getElementById(LAYER_ID)
          if (!layer) {
            layer = document.createElement('div')
            layer.id = LAYER_ID
            layer.setAttribute('aria-hidden', 'true')
            document.body.appendChild(layer)
          }
        }
        if (!scrim || !scrim.isConnected) {
          scrim = document.getElementById(SCRIM_ID)
          if (!scrim) {
            scrim = document.createElement('div')
            scrim.id = SCRIM_ID
            scrim.setAttribute('aria-hidden', 'true')
            document.body.appendChild(scrim)
          }
        }
        return true
      }

      const teardownVideo = () => {
        if (hls) {
          try {
            hls.destroy()
          } catch {
            /* ignore */
          }
          hls = null
        }
        if (video) {
          try {
            video.pause()
            video.removeAttribute('src')
            video.load()
          } catch {
            /* ignore */
          }
          video.remove()
          video = null
        }
        if (poster) {
          poster.remove()
          poster = null
        }
      }

      /** 外壳让开：把根节点与框架的实心底色改成透明，并给 <html> 一个深底 */
      const yieldShell = () => {
        if (yielded.length || !ready()) return
        const html = document.documentElement
        htmlBg = [html.style.getPropertyValue('background-color'), html.style.getPropertyPriority('background-color')]
        html.style.setProperty('background-color', '#05070b', 'important')

        const targets = []
        const root = document.getElementById('root')
        if (root) {
          targets.push(root)
          let el = root.firstElementChild
          for (let depth = 0; depth < 2 && el; depth++) {
            targets.push(el)
            el = el.firstElementChild
          }
        }
        for (const el of targets) {
          yielded.push([
            el,
            el.style.getPropertyValue('background-color'),
            el.style.getPropertyPriority('background-color'),
          ])
          el.style.setProperty('background-color', 'transparent', 'important')
        }
      }

      const restoreShell = () => {
        if (htmlBg) {
          const html = document.documentElement
          if (htmlBg[0]) html.style.setProperty('background-color', htmlBg[0], htmlBg[1])
          else html.style.removeProperty('background-color')
          htmlBg = null
        }
        for (const [el, value, priority] of yielded.reverse()) {
          if (value) el.style.setProperty('background-color', value, priority)
          else el.style.removeProperty('background-color')
        }
        yielded = []
      }

      const isDark = () => document.body && document.body.hasAttribute('data-ds-dark-theme')

      const syncBodyVars = (cfg) => {
        const body = document.body
        if (!body) return
        if (!cfg.enabled) {
          body.removeAttribute(ACTIVE_ATTR)
          return
        }
        body.setAttribute(ACTIVE_ATTR, 'on')
        body.style.setProperty('--bw-surface-rgb', isDark() ? '13, 21, 36' : '255, 255, 255')
        body.style.setProperty('--bw-surface-alpha', String(cfg.surface))
        body.style.setProperty('--bw-scrim', String(cfg.scrim))
      }

      const applyLook = (cfg) => {
        lastCfg = cfg
        if (!ensureNodes()) return
        syncBodyVars(cfg)
        layer.dataset.fit = cfg.fit
        layer.style.setProperty('--bw-blur', cfg.blur + 'px')
        layer.style.setProperty('--bw-blur-scale', String(1 + cfg.blur * 0.004))
        scrim.style.setProperty('--bw-scrim', String(cfg.scrim))
        if (cfg.enabled) yieldShell()
        else restoreShell()
        if (video) {
          video.muted = Boolean(cfg.muted)
          try {
            video.volume = clamp(cfg.volume, 0, 1)
          } catch {
            /* ignore */
          }
          video.playbackRate = clamp(cfg.playbackRate || 1, 0.25, 4)
        }
      }

      const tryPlay = () => {
        if (!video) return
        const p = video.play()
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (!err || err.name !== 'NotAllowedError') return
            // 有声自动播放被拦（浏览器策略）：先静音放起来，但**明确告诉用户**，
            // 下一次点击就把声音还回去 —— 不能让它悄悄变成静音。
            if (!video.muted) {
              video.muted = true
              if (typeof onBlocked === 'function') onBlocked()
              const q = video.play()
              if (q && q.catch) q.catch(() => {})
            }
            if (!resumeOnGesture) {
              resumeOnGesture = () => {
                resumeOnGesture = null
                if (video && lastCfg && !lastCfg.muted) {
                  video.muted = false
                  tryPlay()
                }
              }
              window.addEventListener('pointerdown', resumeOnGesture, { once: true, capture: true })
            }
          })
        }
      }

      const showPoster = (media) => {
        if (poster) {
          poster.remove()
          poster = null
        }
        if (!media || !media.cover) return
        poster = document.createElement('img')
        poster.className = 'bw-poster'
        poster.alt = ''
        poster.referrerPolicy = 'no-referrer'
        poster.src = media.cover
        poster.onerror = () => {
          if (poster) poster.remove()
          poster = null
        }
        layer.insertBefore(poster, layer.firstChild)
      }

      const showVideo = (media, cfg) => {
        teardownVideo()
        if (!ensureNodes()) return
        showPoster(media)
        video = document.createElement('video')
        video.setAttribute('playsinline', '')
        video.setAttribute('webkit-playsinline', '')
        video.autoplay = true
        video.loop = media.kind === 'video'
        video.muted = Boolean(cfg.muted)
        try {
          video.volume = clamp(cfg.volume, 0, 1)
        } catch {
          /* ignore */
        }
        video.playbackRate = clamp(cfg.playbackRate || 1, 0.25, 4)
        video.addEventListener('playing', () => {
          if (layer) layer.dataset.on = 'on'
          if (poster) {
            poster.style.opacity = '0'
            window.setTimeout(() => {
              if (poster) poster.remove()
              poster = null
            }, 650)
          }
        })
        video.addEventListener('error', () => {
          if (layer) delete layer.dataset.on
        })
        layer.appendChild(video)

        if (media.live && HlsCtor && HlsCtor.isSupported && HlsCtor.isSupported()) {
          hls = new HlsCtor({
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            maxBufferLength: 30,
            backBufferLength: 30,
            // 主线程解码：这个包是以自注册脚本动态加载的，省掉 blob worker 那一层不确定性
            enableWorker: false,
          })
          hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
            if (!data || !data.fatal) return
            if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
              try {
                hls.startLoad()
                return
              } catch {
                /* 落到重建 */
              }
            } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
              try {
                hls.recoverMediaError()
                return
              } catch {
                /* 落到重建 */
              }
            }
            try {
              hls.destroy()
            } catch {
              /* ignore */
            }
            hls = null
            if (layer) delete layer.dataset.on
            showPoster(media)
            // 直播地址有有效期（≈几分钟到几十分钟）：挂了就让 Host 重新解析一次
            if (typeof onFatal === 'function') onFatal()
          })
          hls.loadSource(media.url)
          hls.attachMedia(video)
        } else {
          video.src = media.url
        }
        tryPlay()
      }

      return {
        get video() {
          return video
        },
        /** 直播地址失效时回调（store 用它触发一次重新解析） */
        onFatal(fn) {
          onFatal = fn
        },
        /** 有声自动播放被浏览器拦下、临时退到静音时回调 */
        onBlocked(fn) {
          onBlocked = fn
        },
        /** 立刻重试带声音播放（用户点了「打开声音」） */
        unmute() {
          if (!video) return
          video.muted = false
          tryPlay()
        },
        /** cfg 变了就整体对齐；media 变了就换源 */
        apply(cfg, media, opts) {
          if (disposed) return
          applyLook(cfg)
          if (!cfg.enabled) {
            if (layer) delete layer.dataset.on
            teardownVideo()
            lastMedia = null
            return
          }
          const reload = Boolean(opts && opts.reload)
          const sameUrl = lastMedia && media && lastMedia.url && lastMedia.url === media.url
          lastMedia = media
          if (!media) {
            teardownVideo()
            if (layer) delete layer.dataset.on
            return
          }
          if (reload || !sameUrl) showVideo(media, cfg)
        },
        setVisible(visible) {
          if (!video) return
          if (visible) tryPlay()
          else {
            try {
              video.pause()
            } catch {
              /* ignore */
            }
          }
        },
        dispose() {
          disposed = true
          teardownVideo()
          if (resumeOnGesture) {
            window.removeEventListener('pointerdown', resumeOnGesture, true)
            resumeOnGesture = null
          }
          restoreShell()
          if (document.body) {
            document.body.removeAttribute(ACTIVE_ATTR)
            for (const key of ['--bw-surface-rgb', '--bw-surface-alpha', '--bw-scrim']) {
              document.body.style.removeProperty(key)
            }
          }
          if (layer) layer.remove()
          if (scrim) scrim.remove()
          layer = scrim = null
        },
      }
    }

    /* ══ store：页与层共用 ═════════════════════════════════════════════════ */

    function createStore(layer) {
      const listeners = new Set()
      let snapshot = { cfg: { ...DEFAULT_CFG }, media: null, account: {}, busy: '', note: null, loaded: false, conflict: false, audioBlocked: false }
      let timer = 0
      let disposed = false

      const emit = () => {
        for (const fn of Array.from(listeners)) {
          try {
            fn(snapshot)
          } catch (err) {
            console.error('[bili-wallpaper] listener failed：', err)
          }
        }
      }

      const set = (patch) => {
        snapshot = { ...snapshot, ...patch }
        emit()
      }

      const paint = (opts) => {
        layer.apply(snapshot.cfg, snapshot.media, opts)
      }

      const schedule = (delay) => {
        if (disposed) return
        if (timer) window.clearTimeout(timer)
        const media = snapshot.media
        const wait =
          delay != null
            ? delay
            : media && media.live && media.ok
              ? 25 * 60 * 1000
              : media && media.ok
                ? 20 * 60 * 1000
                : 45 * 1000
        timer = window.setTimeout(() => {
          timer = 0
          refresh(false, true)
        }, wait)
      }

      const refresh = async (force, quiet) => {
        if (disposed) return
        if (!quiet) set({ busy: 'resolve' })
        try {
          const state = await api('/state')
          if (disposed) return
          let media = null
          if (state.config.enabled) {
            const resolved = await api('/resolve' + (force ? '?force=1' : ''))
            if (disposed) return
            media = resolved.media || null
            if (resolved.error && !media) media = { ok: false, error: resolved.error, kind: 'unknown' }
          }
          set({
            cfg: state.config,
            account: state.account || {},
            media,
            loaded: true,
            busy: '',
            ...(quiet ? {} : { note: null }),
          })
          paint({ reload: Boolean(force) })
          schedule()
        } catch (err) {
          if (disposed) return
          set({ busy: '', note: { tone: 'bad', text: String(err.message || err) } })
          schedule(15000)
        }
      }

      const patch = async (body, opts) => {
        if (disposed) return
        set({ busy: 'save' })
        try {
          const r = await api('/config', { method: 'POST', body: JSON.stringify(body) })
          if (disposed) return
          const next = { ...snapshot.cfg, ...r.config }
          const needReload = 'source' in body || 'quality' in body || 'enabled' in body
          set({ cfg: next, note: opts && opts.quiet ? null : { tone: 'good', code: 'saved' } })
          paint({ reload: false })
          if (needReload) await refresh(true, true)
          else set({ busy: '' })
        } catch (err) {
          if (disposed) return
          set({ busy: '', note: { tone: 'bad', text: String(err.message || err) } })
        }
      }

      const subscribe = (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      }

      const start = () => {
        refresh(false, false)
      }

      const stop = () => {
        disposed = true
        if (timer) window.clearTimeout(timer)
        listeners.clear()
      }

      // 直播地址过期 / 视频地址失效：立刻重新解析一次（同一媒体只在 20s 内重试一次）
      let lastFatalAt = 0
      layer.onFatal(() => {
        const now = Date.now()
        if (now - lastFatalAt < 20000) return
        lastFatalAt = now
        refresh(true, true)
      })

      // 浏览器拦了有声自动播放：静音先放着，但状态栏要能看见「点一下开声音」
      layer.onBlocked(() => set({ audioBlocked: true }))

      /** 用户点「打开声音」：既改配置（下次也出声），也立刻放行当前这路流 */
      const unmute = async () => {
        set({ audioBlocked: false })
        layer.unmute()
        await patch({ muted: false, volume: Math.max(0.6, snapshot.cfg.volume || 0) }, { quiet: true })
      }

      return {
        get snapshot() {
          return snapshot
        },
        subscribe,
        start,
        stop,
        refresh,
        patch,
        set,
        unmute,
      }
    }

    /* ══ 设置页 ════════════════════════════════════════════════════════════ */

    function SettingsPage(props) {
      const store = props.store
      const t = props.t
      const [, forceRender] = useState(0)
      const [draft, setDraft] = useState('')
      const [login, setLogin] = useState(null)
      const [drag, setDrag] = useState({})
      const pollTimer = useRef(0)
      const saveTimer = useRef(0)
      const pending = useRef({})
      const mounted = useRef(true)

      /* 滑条：拖动时只改本地显示，停手 220ms 再落盘（否则每一格都打一次后端） */
      const slide = (key, value) => {
        setDrag((prev) => ({ ...prev, [key]: value }))
        pending.current[key] = value
        if (saveTimer.current) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = 0
          const patch = { ...pending.current }
          pending.current = {}
          setDrag({})
          if (Object.keys(patch).length) store.patch(patch, { quiet: true })
        }, 220)
      }

      useEffect(() => {
        mounted.current = true
        const unsub = store.subscribe(() => {
          if (mounted.current) forceRender((n) => n + 1)
        })
        return () => {
          mounted.current = false
          unsub()
          if (pollTimer.current) window.clearTimeout(pollTimer.current)
          if (saveTimer.current) window.clearTimeout(saveTimer.current)
        }
      }, [store])

      const snap = store.snapshot
      const cfg = snap.cfg || DEFAULT_CFG
      const lastSource = useRef(null)

      // 来源在别处被改（清除 / 换源 / 别的窗口）时，输入框跟着更新
      useEffect(() => {
        if (lastSource.current === cfg.source) return
        lastSource.current = cfg.source
        setDraft(cfg.source || '')
      }, [cfg.source])

      const startLogin = useCallback(async () => {
        if (pollTimer.current) window.clearTimeout(pollTimer.current)
        setLogin({ qr: '', state: 'waiting', message: '' })
        try {
          const r = await api('/login/start', { method: 'POST', body: '{}' })
          if (!mounted.current) return
          if (!r.ok) {
            setLogin({ qr: '', state: 'unknown', message: r.error || '' })
            return
          }
          setLogin({ qr: r.qr, state: 'waiting', message: '' })
          const tick = async (key) => {
            if (!mounted.current) return
            try {
              const p = await api('/login/poll', { method: 'POST', body: JSON.stringify({ key }) })
              if (!mounted.current) return
              if (p.state === 'ok') {
                setLogin(null)
                await store.refresh(true, true)
                return
              }
              setLogin((prev) =>
                prev ? { ...prev, state: p.state, message: p.message || p.error || '' } : prev,
              )
              if (p.state === 'expired' || p.state === 'unknown') return
            } catch (err) {
              if (mounted.current) {
                setLogin((prev) => (prev ? { ...prev, state: 'unknown', message: String(err.message || err) } : prev))
              }
              return
            }
            pollTimer.current = window.setTimeout(() => tick(key), 2000)
          }
          pollTimer.current = window.setTimeout(() => tick(r.key), 1500)
        } catch (err) {
          if (mounted.current) setLogin({ qr: '', state: 'unknown', message: String(err.message || err) })
        }
      }, [store])

      const logout = useCallback(async () => {
        if (pollTimer.current) window.clearTimeout(pollTimer.current)
        setLogin(null)
        try {
          await api('/logout', { method: 'POST', body: '{}' })
          await store.refresh(true, true)
        } catch (err) {
          store.set({ note: { tone: 'bad', text: String(err.message || err) } })
        }
      }, [store])

      const account = snap.account || {}
      const media = snap.media
      const qualities = (media && Array.isArray(media.qualities) && media.qualities) || []
      const busy = snap.busy

      const sw = (on, onClick) =>
        h(
          'button',
          {
            'data-bw-sw': '',
            ...(on ? { 'data-on': '' } : {}),
            type: 'button',
            role: 'switch',
            'aria-checked': on ? 'true' : 'false',
            onClick,
          },
          h('i'),
        )

      const slider = (label, key, min, max, step, value, format) => {
        const shown = key in drag ? drag[key] : value
        return h(
          'div',
          { 'data-bw-row': '', key },
          h('div', { 'data-bw-label': '', style: { minWidth: 96 } }, label),
          h('input', {
            'data-bw-slider': '',
            type: 'range',
            min,
            max,
            step,
            value: shown,
            onChange: (e) => slide(key, Number(e.target.value)),
          }),
          h('div', { 'data-bw-val': '' }, format ? format(shown) : String(shown)),
        )
      }

      const mediaBlock = () => {
        if (!media) {
          return h('div', { 'data-bw-msg': '' }, cfg.source ? (busy ? t('loading') : t('none')) : t('none'))
        }
        const kind = media.kind === 'live' ? t('live') : media.kind === 'video' ? t('video') : ''
        return h(
          'div',
          { 'data-bw-card': '' },
          h(
            'div',
            { 'data-bw-meta': '' },
            media.cover
              ? h('img', { 'data-bw-thumb': '', src: media.cover, alt: '', referrerPolicy: 'no-referrer' })
              : null,
            h(
              'div',
              { 'data-bw-kv': '' },
              h('div', { 'data-bw-strong': '' }, kind ? h('span', { 'data-bw-tag': '' }, kind) : null, media.title || cfg.source),
              h(
                'div',
                { 'data-bw-note': '' },
                [media.owner ? String(media.owner) : '', media.ok ? t('quality') + ' ' + String(media.quality || '') : '']
                  .filter(Boolean)
                  .join(' · '),
              ),
              media.live && !media.ok ? h('div', { 'data-bw-msg': '', 'data-tone': 'warn' }, t('offline')) : null,
              media.error ? h('div', { 'data-bw-msg': '', 'data-tone': media.ok ? 'warn' : 'bad' }, media.error) : null,
              media.note ? h('div', { 'data-bw-note': '' }, media.note) : null,
            ),
          ),
          h(
            'div',
            { 'data-bw-row': '' },
            h(
              'button',
              { 'data-bw-btn': '', disabled: Boolean(busy), onClick: () => store.refresh(true, false) },
              busy ? t('loading') : t('retry'),
            ),
            h(
              'select',
              {
                'data-bw-select': '',
                value: String(cfg.quality || 0),
                onChange: (e) => store.patch({ quality: Number(e.target.value) }),
              },
              h('option', { value: '0' }, t('auto')),
              qualities.map((q) => h('option', { key: String(q.qn), value: String(q.qn) }, `${q.label} (${q.qn})`)),
            ),
          ),
        )
      }

      return h(
        'div',
        { 'data-bw-page': '' },
        h('div', { 'data-bw-h1': '' }, t('title')),
        h('p', { 'data-bw-lead': '' }, t('lead')),

        h(
          'div',
          { 'data-bw-sec': '' },
          h(
            'div',
            { 'data-bw-row': '' },
            h('div', { 'data-bw-label': '', style: { flex: 1 } }, t('on')),
            sw(cfg.enabled, () => store.patch({ enabled: !cfg.enabled })),
          ),
          h('div', { 'data-bw-note': '' }, t('onHint')),
        ),

        h(
          'div',
          { 'data-bw-sec': '' },
          h('div', { 'data-bw-h': '' }, t('source')),
          h(
            'div',
            { 'data-bw-row': '' },
            h('input', {
              'data-bw-input': '',
              value: draft,
              placeholder: t('sourcePlaceholder'),
              onChange: (e) => setDraft(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter' && draft.trim()) store.patch({ source: draft.trim(), enabled: true })
              },
            }),
            h(
              'button',
              {
                'data-bw-btn': '',
                'data-primary': '',
                disabled: !draft.trim() || Boolean(busy),
                onClick: () => store.patch({ source: draft.trim(), enabled: true }),
              },
              t('apply'),
            ),
            cfg.source
              ? h(
                  'button',
                  {
                    'data-bw-btn': '',
                    onClick: () => {
                      setDraft('')
                      store.patch({ source: '', enabled: false })
                    },
                  },
                  t('clear'),
                )
              : null,
          ),
          h('div', { 'data-bw-note': '' }, t('sourceHint')),
          mediaBlock(),
        ),

        h(
          'div',
          { 'data-bw-sec': '' },
          h('div', { 'data-bw-h': '' }, t('look')),
          h(
            'div',
            { 'data-bw-row': '' },
            h('div', { 'data-bw-label': '', style: { minWidth: 96 } }, t('fit')),
            h(
              'select',
              {
                'data-bw-select': '',
                value: cfg.fit,
                onChange: (e) => store.patch({ fit: e.target.value }, { quiet: true }),
              },
              h('option', { value: 'cover' }, t('fitCover')),
              h('option', { value: 'contain' }, t('fitContain')),
            ),
          ),
          slider(t('blur'), 'blur', 0, 40, 1, cfg.blur, (v) => v + 'px'),
          slider(t('scrim'), 'scrim', 0, 0.9, 0.05, cfg.scrim, pct),
          slider(t('surface'), 'surface', 0.15, 1, 0.05, cfg.surface, pct),
          h(
            'div',
            { 'data-bw-row': '' },
            h('div', { 'data-bw-label': '', style: { flex: 1 } }, t('mute')),
            sw(cfg.muted, () => store.patch({ muted: !cfg.muted }, { quiet: true })),
          ),
          /* 音量滑条常驻：静音时也看得见，用户随时能拨开（0.1.0 把它藏起来是 bug） */
          slider(t('volume'), 'volume', 0, 1, 0.05, cfg.volume, pct),
          snap.audioBlocked && !cfg.muted
            ? h(
                'div',
                { 'data-bw-msg': '', 'data-tone': 'warn', 'data-bw-audiobar': '' },
                h('span', { style: { flex: 1 } }, t('audioBlocked')),
                h('button', { 'data-bw-btn': '', 'data-primary': '', onClick: () => store.unmute() }, t('soundOn')),
              )
            : null,
          slider(t('rate'), 'playbackRate', 0.5, 2, 0.25, cfg.playbackRate, (v) => v + '×'),
          h(
            'div',
            { 'data-bw-row': '' },
            h('div', { 'data-bw-label': '', style: { flex: 1 } }, t('pauseHidden')),
            sw(cfg.pauseOnHidden, () => store.patch({ pauseOnHidden: !cfg.pauseOnHidden }, { quiet: true })),
          ),
        ),

        h(
          'div',
          { 'data-bw-sec': '' },
          h('div', { 'data-bw-h': '' }, t('account')),
          h(
            'div',
            { 'data-bw-row': '' },
            account.loggedIn && account.face
              ? h('img', { 'data-bw-avatar': '', src: account.face, alt: '', referrerPolicy: 'no-referrer' })
              : null,
            h(
              'div',
              { 'data-bw-label': '', style: { flex: 1 } },
              account.loggedIn ? t('loggedIn') + ' · ' + (account.uname || account.mid || '') : t('loggedOut'),
            ),
            account.loggedIn
              ? h('button', { 'data-bw-btn': '', onClick: logout }, t('logout'))
              : h('button', { 'data-bw-btn': '', 'data-primary': '', onClick: startLogin }, t('login')),
          ),
          h('div', { 'data-bw-note': '' }, t('needLogin')),
          login
            ? h(
                'div',
                { 'data-bw-qr': '' },
                login.qr ? h('img', { src: login.qr, alt: 'QR' }) : null,
                h(
                  'div',
                  { 'data-bw-kv': '' },
                  h(
                    'div',
                    { 'data-bw-strong': '' },
                    login.state === 'scanned' ? t('scanned') : login.state === 'expired' ? t('expired') : t('waiting'),
                  ),
                  h('div', { 'data-bw-note': '' }, t('scanning')),
                  login.message ? h('div', { 'data-bw-note': '' }, login.message) : null,
                ),
              )
            : null,
        ),

        snap.note
          ? h('div', { 'data-bw-msg': '', 'data-tone': snap.note.tone || undefined }, snap.note.code ? t(snap.note.code) : snap.note.text)
          : null,
        snap.conflict && cfg.enabled
          ? h('div', { 'data-bw-msg': '', 'data-tone': 'warn' }, t('conflict'))
          : null,
      )
    }

    /* ══ 插件 ══════════════════════════════════════════════════════════════ */

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.setAttribute('data-plugin-css', TAG)
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, TAG + ': styles')

        const layer = createLayer()
        const store = createStore(layer)

        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        const langOf = () => {
          let active = ''
          try {
            const snap = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
            active = String((snap && snap.active) || '')
          } catch {
            active = ''
          }
          if (!active && typeof navigator !== 'undefined') active = String(navigator.language || '')
          return active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        }
        const tOf = (lang) => (key) => (COPY[lang] && COPY[lang][key]) || COPY.zh[key] || key

        ctx.effect(() => {
          const onVisibility = () => {
            if (!store.snapshot.cfg.pauseOnHidden) return
            layer.setVisible(!document.hidden)
          }
          const onBodyAttr = () => {
            // 明暗主题切换时，面板色的深浅要跟着换
            layer.apply(store.snapshot.cfg, store.snapshot.media, { reload: false })
            store.set({ conflict: document.body ? document.body.hasAttribute('data-we-wallpaper') : false })
          }
          document.addEventListener('visibilitychange', onVisibility)
          const observer = new MutationObserver(onBodyAttr)
          if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-we-wallpaper'] })
          onBodyAttr()
          store.start()
          return () => {
            document.removeEventListener('visibilitychange', onVisibility)
            observer.disconnect()
            store.stop()
            layer.dispose()
          }
        }, TAG + ': layer')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (slots) {
          slots.inject('settings.section', () =>
            slots.register(
              {
                name: 'settings.section',
                id: TAG,
                order: 55,
                label: () => (langOf() === 'zh' ? COPY.zh.nav : COPY.en.nav),
              },
              () => {
                const lang = langOf()
                return h(SettingsPage, { store, t: tOf(lang) })
              },
            ),
          )
        }
      },
    }
  },
})