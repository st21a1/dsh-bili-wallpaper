/**
 * dsh-bili-wallpaper —— Host 半端
 * ============================================================================
 * 把 B 站的「直播间实时画面」或「某个视频」当作 DSH Web GUI 的背景。
 *
 * 这一半只做四件事（浏览器那一半负责画）：
 *   ① 扫码登录（passport 二维码接口，凭证落 <DSH_HOME>/bili-wallpaper/）
 *   ② 解析来源：直播链接 / 房号 → HLS；视频链接 / BV 号 / av 号 → MP4
 *   ③ 通过同源代理把媒体流递给浏览器（B 站视频 CDN 要 Referer，HLS 分片要重写清单）
 *   ④ 存设置（<DSH_HOME>/bili-wallpaper/config.json），给设置页读写
 *
 * 路由（全部同源 + 本机校验，前缀 /api/bili-wallpaper）：
 *   GET  /state                配置 + 账号
 *   POST /config               改配置（部分字段）
 *   POST /login/start          出二维码（SVG data URL）
 *   POST /login/poll           轮询扫码结果
 *   POST /logout               退出登录
 *   GET  /resolve              解析当前来源 → 可播放的代理地址 + 清晰度表
 *   GET  /proxy?u=&t=&k=       媒体代理（HLS 清单会被改写成一串同样的代理地址）
 * ============================================================================
 */
import { createHmac, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

export const name = 'bili-wallpaper'
export const inject = ['webServer']

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const API_PREFIX = '/api/bili-wallpaper'
const LOG = '[bili-wallpaper]'

/* ── 配置 ─────────────────────────────────────────────────────────────────── */

const DEFAULTS = {
  enabled: false,
  source: '',
  quality: 0, // 0 = 自动（能拿到的最好一档）
  fit: 'cover',
  blur: 0,
  scrim: 0.45,
  surface: 0.72,
  // 默认出声：静音必须是用户主动选的，不能是出厂状态
  muted: false,
  volume: 0.6,
  playbackRate: 1,
  pauseOnHidden: true,
  /** 当前分P（1 起）。只有多P视频有意义，单P视频恒为 1。 */
  page: 1,
  /**
   * 当前视频播完之后做什么：
   *   loop      重头再来（0.1.x 的行为，保留为可选）
   *   next      播下一P；已经是最后一P就停住（默认）
   *   stop      播完就停在最后一帧
   *   hide      播完关掉背景（恢复宿主原生外观）
   */
  endAction: 'next',
  /** 记住进度：再次打开同一个视频从上次位置继续 */
  resume: true,
  configVersion: 3,
}

/**
 * 0.1.0 的坑：出厂 `muted: true`，而设置页在静音时把音量滑条整个隐藏
 * ⇒ 用户既听不到声音，也找不到从哪儿打开。凡是在 0.1.x 写过配置的，
 * 那个 `muted: true` 是插件替用户做的决定，不是他的选择 —— 升级时一次性翻成 false。
 * 之后用户自己再静音，configVersion 已经是 2，不会再被动。
 */
const CONFIG_VERSION = 3

const END_ACTIONS = new Set(['loop', 'next', 'stop', 'hide'])

const NUM_RANGE = {
  blur: [0, 40],
  scrim: [0, 0.9],
  surface: [0.15, 1],
  volume: [0, 1],
  playbackRate: [0.25, 4],
}

function clampNumber(key, value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  const r = NUM_RANGE[key]
  if (!r) return n
  return Math.min(r[1], Math.max(r[0], n))
}

export function normalizeConfig(input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}
  if (typeof src.enabled === 'boolean') out.enabled = src.enabled
  if (typeof src.source === 'string') out.source = src.source.slice(0, 500)
  if (typeof src.fit === 'string') out.fit = src.fit === 'contain' ? 'contain' : 'cover'
  if (typeof src.pauseOnHidden === 'boolean') out.pauseOnHidden = src.pauseOnHidden
  if (typeof src.muted === 'boolean') out.muted = src.muted
  if (typeof src.resume === 'boolean') out.resume = src.resume
  if (typeof src.endAction === 'string' && END_ACTIONS.has(src.endAction)) out.endAction = src.endAction

  const version = Number(src.configVersion) || 1
  const legacyMute = version < CONFIG_VERSION && src.muted === true
  if (legacyMute) out.muted = false

  const qn = Number(src.quality)
  if (Number.isFinite(qn) && qn >= 0) out.quality = Math.round(qn)
  const pg = Number(src.page)
  if (Number.isFinite(pg) && pg >= 1) out.page = Math.round(pg)
  for (const key of Object.keys(NUM_RANGE)) {
    if (key in src) {
      const v = clampNumber(key, src[key])
      if (v !== undefined) out[key] = v
    }
  }
  // 没静音却没音量 = 用户取消了静音还是听不见，补一个能听见的值
  if (!out.muted && !(out.volume > 0)) out.volume = DEFAULTS.volume
  out.configVersion = CONFIG_VERSION
  return out
}

/* ── 家目录与文件 ─────────────────────────────────────────────────────────── */

function stateDirOf() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || homedir(), '.dsh')
  return join(home, 'bili-wallpaper')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/* 凭证文件尽量只让当前用户读（失败不致命） */
function harden(file) {
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows 上 chmod 基本是空操作，够用就行 */
  }
}

/* ── 二维码 ───────────────────────────────────────────────────────────────── */

let qrRenderer = null
function renderQrSvg(text) {
  if (!qrRenderer) {
    const require = createRequire(import.meta.url)
    const core = require(fileURLToPath(new URL('./vendor/qrcode/lib/core/qrcode.js', import.meta.url)))
    const svgTag = require(fileURLToPath(new URL('./vendor/qrcode/lib/renderer/svg-tag.js', import.meta.url)))
    qrRenderer = (t) =>
      svgTag.render(core.create(t, { errorCorrectionLevel: 'M' }), {
        type: 'svg',
        margin: 1,
        width: 220,
        color: { dark: '#000000ff', light: '#ffffffff' },
      })
  }
  const svg = qrRenderer(text)
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

/* ── B 站接口 ─────────────────────────────────────────────────────────────── */

/**
 * 风控类错误码：这些不是「参数错了」，而是「你这次请求被怀疑是机器人」。
 *   -351 受到神秘力量干扰（最常见）
 *   -352 风控校验失败
 *   -412 请求被拦截
 *   -509 请求过于频繁
 * 对它们值得等一下再试，也值得给用户一句能看懂的解释。
 */
const RISK_CONTROL_CODES = new Set([-351, -352, -412, -509])
const RISK_CONTROL_HINT =
  'B 站风控拦截（-351「受到神秘力量干扰」）。通常不是地址写错：常见原因是出口 IP 被限、短时间内请求过多，或未登录且缺少设备指纹。已自动重试；仍失败可稍等几分钟、换个网络，或在设置页扫码登录后再试。'

class BiliApiError extends Error {
  constructor(code, message, { risk = false, status = 0 } = {}) {
    super(message)
    this.name = 'BiliApiError'
    this.code = code
    this.risk = risk
    this.status = status
  }
}

const RISK_RETRY_DELAYS = [600, 1600, 3200] // 退避重试：总共最多 3 次

/**
 * 调 B 站接口。对风控码自动退避重试；普通业务错误（比如 -404 视频不存在）直接抛。
 *
 * `biliToken` 是插件自己的 buvid3（未登录也用），能在风控眼里更像正常客户端。
 */
async function biliJson(url, { referer, cookie, timeout = 15000, retries = RISK_RETRY_DELAYS.length } = {}) {
  const headers = { 'user-agent': UA }
  if (referer) headers.referer = referer
  if (cookie) headers.cookie = cookie

  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) })
    } catch (err) {
      // 网络层失败同样值得重试（这条链路经常抖）
      lastErr = new BiliApiError(-1, `连不上 B 站接口：${err?.message || err}`)
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, RISK_RETRY_DELAYS[Math.min(attempt, RISK_RETRY_DELAYS.length - 1)]))
        continue
      }
      throw lastErr
    }

    if (res.status === 412 || res.status === 429) {
      lastErr = new BiliApiError(res.status, `B 站返回 HTTP ${res.status}`, { risk: true, status: res.status })
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, RISK_RETRY_DELAYS[Math.min(attempt, RISK_RETRY_DELAYS.length - 1)]))
        continue
      }
      throw lastErr
    }
    if (!res.ok) throw new BiliApiError(res.status, `B站接口 HTTP ${res.status}`, { status: res.status })

    let body
    try {
      body = await res.json()
    } catch {
      throw new BiliApiError(-2, 'B 站返回了无法解析的内容')
    }

    const code = body && typeof body.code === 'number' ? body.code : 0
    if (code === 0) return body

    const risk = RISK_CONTROL_CODES.has(code)
    lastErr = new BiliApiError(code, `B站接口 ${code}：${body.message || '未知错误'}`, { risk })
    if (risk && attempt < retries) {
      await new Promise((r) => setTimeout(r, RISK_RETRY_DELAYS[Math.min(attempt, RISK_RETRY_DELAYS.length - 1)]))
      continue
    }
    throw lastErr
  }
  throw lastErr
}

/** 把内部错误翻译成用户能看懂的一句话 */
function explainBiliError(err) {
  if (err && err.risk) return RISK_CONTROL_HINT
  return String(err?.message || err)
}

/**
 * 未登录时也要带的 cookie。
 *
 * B 站风控主要认设备指纹（buvid3）。未登录还裸着发请求，被 -351 拦的概率明显更高，
 * 所以这里拿一次 finger/spi 的 b_3 并缓存在进程内，之后所有匿名请求都带上。
 */
async function anonymousCookie() {
  if (!pluginBuvid3) {
    try {
      const j = await biliJson('https://api.bilibili.com/x/frontend/finger/spi')
      if (j?.data?.b_3) pluginBuvid3 = j.data.b_3
    } catch {
      /* 拿不到就空着，请求照发 */
    }
  }
  return pluginBuvid3 ? `buvid3=${pluginBuvid3}` : ''
}

/**
 * 登录后要带的 cookie。
 *
 * ⚠️ 刻意**不带 buvid3**：实测（2026-11）`SESSDATA + buvid3` 的组合会被 B 站
 * 判为「同一账号 + 陌生设备指纹」，playurl 直接返回 -351；而同一次请求去掉
 * buvid3 立刻 code=0。`SESSDATA` / `bili_jct` / `DedeUserID` 单独带都正常。
 *
 * buvid3 只在匿名请求里用（见 anonymousCookie）—— 那里它是加分项，
 * 一旦叠上登录态就成了减分项。
 */
function cookieOf(cred) {
  if (!cred || !cred.sessdata) return ''
  const parts = [`SESSDATA=${cred.sessdata}`]
  if (cred.bili_jct) parts.push(`bili_jct=${cred.bili_jct}`)
  if (cred.dedeuserid) parts.push(`DedeUserID=${cred.dedeuserid}`)
  return parts.join('; ')
}

function pickCookies(list) {
  const jar = {}
  const want = { SESSDATA: 'sessdata', bili_jct: 'bili_jct', DedeUserID: 'dedeuserid', buvid3: 'buvid3' }
  for (const raw of list || []) {
    const first = String(raw).split(';')[0] || ''
    const i = first.indexOf('=')
    if (i <= 0) continue
    const key = want[first.slice(0, i).trim()]
    if (key) jar[key] = first.slice(i + 1).trim()
  }
  return jar
}

let pluginBuvid3 = '' // 插件自己的设备指纹：未登录时也带上，降低被风控的概率
async function ensureBuvid3(jar) {
  if (jar.buvid3) return jar
  if (pluginBuvid3) {
    jar.buvid3 = pluginBuvid3
    return jar
  }
  try {
    const j = await biliJson('https://api.bilibili.com/x/frontend/finger/spi')
    if (j?.data?.b_3) {
      pluginBuvid3 = j.data.b_3
      jar.buvid3 = pluginBuvid3
    }
  } catch {
    /* 拿不到就空着，不影响登录 */
  }
  return jar
}

async function accountOf(cred) {
  if (!cred || !cred.sessdata) return { loggedIn: false }
  try {
    const j = await biliJson('https://api.bilibili.com/x/web-interface/nav', { cookie: cookieOf(cred) })
    const d = j?.data
    if (!d || !d.isLogin) return { loggedIn: false, stale: true }
    return {
      loggedIn: true,
      mid: d.mid,
      uname: d.uname,
      face: typeof d.face === 'string' && d.face.startsWith('http') ? d.face : '',
      vip: Boolean(d.vipStatus),
      level: d.level_info?.current_level ?? 0,
    }
  } catch (err) {
    return { loggedIn: false, error: String(err?.message || err) }
  }
}

/* ── 来源解析 ─────────────────────────────────────────────────────────────── */

const LIVE_QN_LABEL = {
  30000: '杜比',
  20000: '4K',
  15000: '2K',
  10000: '原画',
  400: '蓝光',
  250: '超清',
  150: '高清',
  80: '流畅',
}

const VIDEO_QN_LABEL = {
  127: '8K',
  126: '杜比视界',
  125: 'HDR',
  120: '4K',
  116: '1080P60',
  112: '1080P+',
  80: '1080P',
  74: '720P60',
  64: '720P',
  32: '480P',
  16: '360P',
  6: '240P',
}

/** 用户输入 → { kind:'live', roomId } | { kind:'video', bvid|aid, page, pageFromUrl } | null */
function parseSource(rawInput) {
  const raw = String(rawInput || '').trim()
  if (!raw) return null
  const pageMatch = /[?&]p=(\d+)/.exec(raw)
  const pageFromUrl = Boolean(pageMatch)
  const pageOfUrl = pageFromUrl ? Math.max(1, Number(pageMatch[1])) : 0
  const bv = /(BV[0-9A-Za-z]{10})/.exec(raw)
  if (bv) {
    return { kind: 'video', bvid: bv[1], page: pageFromUrl ? pageOfUrl : 1, pageFromUrl }
  }
  const av = /\/video\/av(\d+)/i.exec(raw) || /^av(\d+)$/i.exec(raw)
  if (av) {
    return { kind: 'video', aid: Number(av[1]), page: pageFromUrl ? pageOfUrl : 1, pageFromUrl }
  }
  const live = /live\.bilibili\.com\/(?:blanc\/|h5\/)?(\d+)/i.exec(raw)
  if (live) return { kind: 'live', roomId: Number(live[1]) }
  if (/^\d{1,12}$/.test(raw)) return { kind: 'live', roomId: Number(raw) }
  return null
}

async function expandShortLink(input) {
  const raw = String(input || '').trim()
  const m = /^(https?:\/\/)?b23\.tv\/[0-9A-Za-z]+/i.exec(raw)
  if (!m) return null
  const url = raw.startsWith('http') ? raw : 'https://' + raw
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  })
  return res.url || null
}

async function resolveLive(roomId, wantedQn, cred) {
  const cookie = cookieOf(cred) || (await anonymousCookie())
  const info = await biliJson(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, { cookie })
  const data = info.data || {}
  if (!data.room_id) throw new Error('找不到这个直播间')
  const rid = data.room_id
  if (data.live_status !== 1) {
    return {
      ok: false,
      kind: 'live',
      title: data.title || `直播间 ${rid}`,
      cover: data.user_cover || data.keyframe || '',
      error: '这个直播间现在没开播（开播后会自动接上）',
      offline: true,
    }
  }
  const qn = wantedQn > 0 ? wantedQn : 10000
  const url =
    `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${rid}` +
    `&protocol=0,1&format=0,1,2&codec=0,1&qn=${qn}&platform=web&ptype=8&dolby=5&panorama=1`
  const play = await biliJson(url, { referer: `https://live.bilibili.com/${rid}`, cookie })
  const playurl = play?.data?.playurl_info?.playurl
  if (!playurl) {
    return { ok: false, kind: 'live', title: data.title || `直播间 ${rid}`, error: 'B 站没给出播放地址，稍后重试' }
  }

  const candidates = []
  for (const stream of playurl.stream || []) {
    if (stream.protocol_name !== 'http_hls') continue
    for (const fmt of stream.format || []) {
      for (const codec of fmt.codec || []) {
        if (codec.codec_name !== 'avc') continue
        const host = codec.url_info?.[0]?.host
        const extra = codec.url_info?.[0]?.extra
        if (!host || !codec.base_url) continue
        candidates.push({
          format: fmt.format_name,
          url: host + codec.base_url + (extra ? '&' + extra : ''),
          qn: codec.current_qn,
          accept: codec.accept_qn || [],
        })
      }
    }
  }
  // ts 优先：AAC 音轨直接混在分片里，音画天然同步（fmp4 的独立音轨不保证跟着走）
  const chosen = candidates.find((c) => c.format === 'ts') || candidates.find((c) => c.format === 'fmp4')
  if (!chosen) {
    return { ok: false, kind: 'live', title: data.title || `直播间 ${rid}`, error: '这个直播只提供了 FLV 流，暂不支持' }
  }

  const qualities = (playurl.g_qn_desc || [])
    .filter((q) => chosen.accept.includes(q.qn))
    .map((q) => ({ qn: q.qn, label: q.media_base_desc?.detail_desc?.desc || LIVE_QN_LABEL[q.qn] || q.desc }))
    .sort((a, b) => b.qn - a.qn)

  return {
    ok: true,
    kind: 'live',
    live: true,
    hasAudio: true,
    audioCodec: 'aac',
    roomId: rid,
    title: data.title || `直播间 ${rid}`,
    owner: data.uid,
    cover: data.user_cover || data.keyframe || '',
    url: chosen.url,
    quality: chosen.qn,
    qualities: qualities.length ? qualities : [{ qn: chosen.qn, label: LIVE_QN_LABEL[chosen.qn] || String(chosen.qn) }],
    note: cred?.sessdata ? '' : '未登录时通常只拿得到「超清」；扫码登录后能选原画',
    refreshAfter: 8 * 60 * 1000,
  }
}

async function resolveVideo(parsed, wantedQn, cred) {
  const cookie = cookieOf(cred) || (await anonymousCookie())
  const query = parsed.bvid ? `bvid=${parsed.bvid}` : `aid=${parsed.aid}`
  const view = await biliJson(`https://api.bilibili.com/x/web-interface/view?${query}`, { cookie })
  const d = view.data || {}
  if (!d.bvid) throw new Error('找不到这个视频')
  const pages = Array.isArray(d.pages) && d.pages.length ? d.pages : [{ cid: d.cid, page: 1, part: d.title }]
  const page = pages[Math.min(pages.length - 1, Math.max(0, (parsed.page || 1) - 1))] || pages[0]
  const cid = page.cid
  const qn = wantedQn > 0 ? wantedQn : 80
  const api =
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(d.bvid)}&cid=${cid}` +
    `&qn=${qn}&fnval=1&fnver=0&fourk=1&platform=html5&high_quality=1`
  const pu = await biliJson(api, { referer: `https://www.bilibili.com/video/${d.bvid}`, cookie })
  const pd = pu.data || {}
  const durl = Array.isArray(pd.durl) ? pd.durl : []
  if (!durl.length) throw new Error('B 站没给出视频地址（可能要大会员 / 该视频不允许外链播放）')

  const acceptQ = Array.isArray(pd.accept_quality) ? pd.accept_quality : []
  const acceptD = Array.isArray(pd.accept_description) ? pd.accept_description : []
  let qualities = acceptQ.map((q, i) => ({ qn: Number(q), label: acceptD[i] || VIDEO_QN_LABEL[q] || String(q) }))
  if (!qualities.length) {
    qualities = (pd.support_formats || []).map((f) => ({
      qn: Number(f.quality),
      label: f.new_description || f.display_desc || VIDEO_QN_LABEL[f.quality] || String(f.quality),
    }))
  }
  if (!qualities.length) {
    qualities = [{ qn: Number(pd.quality) || 0, label: VIDEO_QN_LABEL[pd.quality] || String(pd.quality || '') }]
  }
  qualities.sort((a, b) => b.qn - a.qn)

  return {
    ok: true,
    kind: 'video',
    live: false,
    hasAudio: true, // durl 的 mp4 音画合一
    bvid: d.bvid,
    aid: d.aid,
    cid,
    page: page.page || 1,
    pages: pages.length,
    part: page.part || '',
    /** 分P列表：客户端用它算「下一P」，只带必要字段 */
    parts: pages.map((p, i) => ({
      page: p.page || i + 1,
      cid: p.cid,
      title: p.part || `P${p.page || i + 1}`,
      duration: p.duration || 0,
    })),
    title: d.title || page.part || d.bvid,
    owner: d.owner?.name || '',
    cover: d.pic || '',
    duration: page.duration || d.duration || 0,
    totalDuration: d.duration || 0,
    url: durl[0].url,
    quality: Number(pd.quality) || qualities[0].qn,
    qualities,
    segmented: durl.length > 1,
    note: durl.length > 1 ? '这条视频被 B 站切成多段，当前只播放第一段' : '',
    refreshAfter: 25 * 60 * 1000,
  }
}

/* ── 代理与签名 ───────────────────────────────────────────────────────────── */

const SECRET = randomBytes(32)
const ALLOWED_HOSTS = [
  'bilivideo.com',
  'bilivideo.cn',
  'bilivideo.net',
  'bilibili.com',
  'hdslb.com',
  'akamaized.net',
  'szbdyd.com',
  'bcelive.com',
]

function sign(url) {
  return createHmac('sha256', SECRET).update(url).digest('base64url').slice(0, 22)
}

function proxyUrl(url, kind) {
  return `${API_PREFIX}/proxy?k=${kind}&u=${Buffer.from(url, 'utf8').toString('base64url')}&t=${sign(url)}`
}

function hostAllowed(hostname) {
  const h = String(hostname || '').toLowerCase()
  return ALLOWED_HOSTS.some((suffix) => h === suffix || h.endsWith('.' + suffix))
}

function rewritePlaylist(text, baseUrl, kind) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => {
          try {
            return `URI="${proxyUrl(new URL(uri, baseUrl).toString(), kind)}"`
          } catch {
            return `URI="${uri}"`
          }
        })
      }
      try {
        return proxyUrl(new URL(trimmed, baseUrl).toString(), kind)
      } catch {
        return line
      }
    })
    .join('\n')
}

async function handleProxy(req, res, url) {
  const kind = url.searchParams.get('k') === 'video' ? 'video' : 'live'
  const u = url.searchParams.get('u') || ''
  const t = url.searchParams.get('t') || ''
  let target = ''
  try {
    target = Buffer.from(u, 'base64url').toString('utf8')
  } catch {
    /* 交给下面的校验 */
  }
  if (!target || sign(target) !== t) {
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: 'bad signature' }))
    return
  }
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    res.writeHead(400).end()
    return
  }
  if (!/^https?:$/.test(parsed.protocol) || !hostAllowed(parsed.hostname)) {
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: 'host not allowed' }))
    return
  }

  const headers = {
    'user-agent': UA,
    referer: kind === 'video' ? 'https://www.bilibili.com/' : 'https://live.bilibili.com/',
  }
  if (req.headers.range) headers.range = String(req.headers.range)
  if (req.headers['if-range']) headers['if-range'] = String(req.headers['if-range'])

  const ac = new AbortController()
  let closed = false
  res.on('close', () => {
    closed = true
    ac.abort()
  })

  let upstream
  try {
    upstream = await fetch(target, { headers, signal: ac.signal, redirect: 'follow' })
  } catch (err) {
    if (closed) return
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
    return
  }

  const contentType = String(upstream.headers.get('content-type') || '')
  const looksLikePlaylist =
    /mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(parsed.pathname + parsed.search)

  if (!upstream.ok && upstream.status !== 206) {
    /*
     * 416（Range Not Satisfiable）必须**原样**透传。
     *
     * 浏览器加载视频时会向文件末尾附近发探测 Range；越界时上游回 416，
     * 这是它理解的正常语义。若我们把它裹成 502「网关错误」，
     * Chrome 会判定整个媒体不可 seek —— seekable 归零，拖进度条视频不跳。
     * 同类需要原样透传的还有 401/403/404/405/429。
     */
    const passthrough = new Set([401, 403, 404, 405, 416, 429])
    const status = passthrough.has(upstream.status) ? upstream.status : 502
    const head = {
      'content-type': contentType || 'text/plain',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'x-upstream-status': String(upstream.status),
    }
    const cr0 = upstream.headers.get('content-range')
    if (cr0) head['content-range'] = cr0
    res.writeHead(status, head)
    try {
      const text = await upstream.text()
      res.end(text.slice(0, 400))
    } catch {
      res.end()
    }
    return
  }

  if (looksLikePlaylist) {
    let text = ''
    try {
      text = await upstream.text()
    } catch {
      if (!closed) res.writeHead(502).end()
      return
    }
    const body = rewritePlaylist(text, target, kind)
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'access-control-allow-origin': '*',
    })
    res.end(body)
    return
  }

  const outHeaders = {
    'content-type': contentType || 'application/octet-stream',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
  }

  const cr = upstream.headers.get('content-range')
  if (cr) outHeaders['content-range'] = cr

  /*
   * Content-Length 必须尽量给出来。
   *
   * B 站 CDN 对超大文件（十几小时的录播、几百 MB）经常用 chunked 传输，
   * 此时上游没有 content-length。若照旧不回长度，浏览器收到的是一个
   * 「无确定长度」的 206：视频能顺序播放、也会缓冲，但 seekable 会停在
   * [0, 0]，给 currentTime 赋值被静默忽略 —— 表现就是「拖进度条视频不跳」。
   * 实测现场：buffered=[0,159] 而 seekable=[0,0]，同时 content-length=null。
   *
   * 长度按优先级取：上游 content-length → 从 content-range 的 a-b 推算。
   */
  const upstreamLen = upstream.headers.get('content-length')
  if (upstreamLen) {
    outHeaders['content-length'] = upstreamLen
  } else if (cr) {
    const range = /bytes\s+(\d+)-(\d+)\//i.exec(cr)
    if (range) outHeaders['content-length'] = String(Number(range[2]) - Number(range[1]) + 1)
  }

  /*
   * 上游忽略 Range、回了一整份 200 时，绝不能把 200 + Content-Range 一起丢给浏览器：
   * 那是不合法的组合，浏览器会判定「服务端不会做 Range」，于是 seekable 归零。
   * 这种情况退回「不支持跳转的普通 200」，并把 Range 相关头全部丢掉，
   * 让浏览器至少能正常顺序播放，而不是拿到自相矛盾的响应。
   */
  const upstreamPartial = upstream.status === 206
  if (req.headers.range && !upstreamPartial) {
    delete outHeaders['content-range']
    // 这是整份文件，长度只有在确实知道时才声明
    const total = upstream.headers.get('content-length')
    if (total) outHeaders['content-length'] = total
    else delete outHeaders['content-length']
  }

  res.writeHead(upstream.status === 206 ? 206 : 200, outHeaders)

  // HEAD 只回头，不回体（浏览器用它探测可 seek 性）
  if (req.method === 'HEAD') {
    try {
      upstream.body?.cancel?.()
    } catch {
      /* ignore */
    }
    res.end()
    return
  }

  if (!upstream.body) {
    res.end()
    return
  }
  try {
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      if (closed) break
      res.write(chunk)
    }
  } catch {
    /* 客户端主动断开（切源 / 关页面）是常态 */
  } finally {
    try {
      res.end()
    } catch {
      /* 已经结束 */
    }
  }
}

/* ── HTTP 小工具 ──────────────────────────────────────────────────────────── */

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req, limit = 64 * 1024) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体太大')
    parts.push(chunk)
  }
  if (!parts.length) return {}
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

/* ── 插件 ─────────────────────────────────────────────────────────────────── */

export function apply(ctx) {
  const dir = stateDirOf()
  const configFile = join(dir, 'config.json')
  const credentialFile = join(dir, 'bili_credential.json')
  const progressFile = join(dir, 'progress.json')

  let config = normalizeConfig(readJson(configFile, {}))
  let credential = readJson(credentialFile, null)
  let accountCache = null
  let accountAt = 0
  let resolveCache = null
  let resolveAt = 0
  let loginKey = ''

  const log = (msg) => {
    try {
      if (ctx.logger && typeof ctx.logger.info === 'function') {
        ctx.logger.info(msg)
        return
      }
    } catch {
      /* 落到 console */
    }
    console.log(LOG, msg)
  }

  // 迁移过一次就落盘，免得每次启动都重算
  try {
    const onDisk = readJson(configFile, {})
    if (onDisk && JSON.stringify(onDisk) !== JSON.stringify(config)) writeJson(configFile, config)
  } catch {
    /* 写失败不影响运行 */
  }

  const saveConfig = (patch) => {
    config = normalizeConfig({ ...config, ...patch })
    try {
      writeJson(configFile, config)
    } catch (err) {
      log(`写配置失败：${err?.message || err}`)
    }
    resolveCache = null
    return config
  }

  const getAccount = async (force = false) => {
    if (!force && accountCache && Date.now() - accountAt < 30000) return accountCache
    accountCache = await accountOf(credential)
    accountAt = Date.now()
    return accountCache
  }

  /**
   * 媒体地址必须是**绝对 http://**。
   *
   * DSH 桌面版用自定义协议加载页面（页面源是 dsh-app://app），相对路径会被
   * 解析成 dsh-app://app/api/…。Chromium 的媒体栈对非 http(s) scheme 的
   * Range 支持不完整：能顺序播放、也会缓冲，但 seekable 恒为 [0,0]，
   * 给 currentTime 赋值被静默忽略 —— 表现为「拖进度条视频不跳」。
   * 所以这里用 webServer.getOrigin() 拼成 http://127.0.0.1:<port>/…，
   * 让媒体走标准 HTTP，浏览器才会把它当作可随机访问的资源。
   */
  const mediaOrigin = () => {
    try {
      const o = ctx.webServer?.getOrigin?.()
      if (o) return String(o).replace(/\/+$/, '')
    } catch {
      /* 拿不到就退回相对路径 */
    }
    return ''
  }

  const resolveSource = async (force = false) => {
    if (!force && resolveCache && Date.now() - resolveAt < 5000) return resolveCache
    const raw = config.source
    if (!raw) return { ok: false, error: '还没填直播链接或视频地址' }

    let parsed = parseSource(raw)
    if (!parsed) {
      const expanded = await expandShortLink(raw).catch(() => null)
      if (expanded) parsed = parseSource(expanded)
    }
    if (!parsed) {
      return { ok: false, error: '认不出这个地址：填直播链接 / 直播间号，或者视频链接 / BV 号' }
    }

    // 分P 以配置里的 page 为准（地址里写了 ?p=N 时仍尊重地址，配置在切P时同步）
    if (parsed.kind === 'video' && config.page > 1 && !parsed.pageFromUrl) {
      parsed.page = config.page
    }

    const result =
      parsed.kind === 'live'
        ? await resolveLive(parsed.roomId, config.quality, credential)
        : await resolveVideo(parsed, config.quality, credential)

    if (result.ok && result.url) {
      const rel = proxyUrl(result.url, result.kind === 'video' ? 'video' : 'live')
      const origin = mediaOrigin()
      result.url = origin ? origin + rel : rel
      result.resolvedAt = Date.now()
    }
    resolveCache = result
    resolveAt = Date.now()
    return result
  }

  const sameOriginOk = (req) => {
    const host = String(req.headers.host || '')
    if (!host) return true
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
    const pick = String(req.headers.origin || req.headers.referer || '')
    if (!pick) return true
    try {
      const u = new URL(pick)
      const authority = String(u.host || '').toLowerCase()
      if (authority && authority === host.toLowerCase()) return true
      const port = u.port || (u.protocol === 'https:' ? '443' : '80')
      return `${u.hostname}:${port}`.toLowerCase() === host.toLowerCase()
    } catch {
      return false
    }
  }

  let connCache
  let connTried = false
  const getConnection = () => {
    if (connTried) return connCache
    connTried = true
    for (const read of [
      () => (typeof ctx.get === 'function' ? ctx.get('connection') : null),
      () => Reflect.get(ctx, 'connection'),
      () => ctx.root?.connection,
    ]) {
      try {
        const c = read()
        if (c && typeof c.requestRejection === 'function') {
          connCache = c
          return c
        }
      } catch {
        /* 换下一种写法 */
      }
    }
    return null
  }

  const fenceReject = (req, res) => {
    const conn = getConnection()
    if (!conn) return false
    try {
      const rejection = conn.requestRejection({ headers: req.headers })
      if (rejection === undefined) return false
      res.statusCode = typeof rejection === 'number' ? rejection : 403
      res.end()
      return true
    } catch {
      res.statusCode = 403
      res.end()
      return true
    }
  }

  const handle = async (req, res, url) => {
    const path = url.pathname.slice(API_PREFIX.length) || '/'
    const method = req.method || 'GET'

    if (method === 'GET' && (path === '/state' || path === '/')) {
      const account = await getAccount()
      const media = resolveCache // 可能为 null；客户端仍会用 /resolve 拉最新
      let savedProgress = null
      if (media && media.ok && media.kind === 'video' && media.bvid) {
        const all = readJson(progressFile, {})
        savedProgress = all[`video:${media.bvid}`] || null
      }
      return sendJson(res, 200, {
        ok: true,
        version: '0.3.0',
        home: dir,
        config,
        account,
        progress: savedProgress,
        loginPending: Boolean(loginKey),
      })
    }

    if (method === 'POST' && path === '/config') {
      const body = await readJsonBody(req)
      const patch = {}
      for (const key of Object.keys(DEFAULTS)) if (key in body) patch[key] = body[key]
      const next = saveConfig(patch)
      return sendJson(res, 200, { ok: true, config: next })
    }

    /* 播放进度：客户端定期上报，切换视频 / 重启后能接着看 */
    if (method === 'GET' && path === '/progress') {
      const key = url.searchParams.get('key') || ''
      const all = readJson(progressFile, {})
      return sendJson(res, 200, { ok: true, progress: key ? all[key] || null : all })
    }

    if (method === 'POST' && path === '/progress') {
      const body = await readJsonBody(req)
      const key = String(body.key || '').slice(0, 80)
      if (!key) return sendJson(res, 200, { ok: false, error: '缺少 key' })
      const all = readJson(progressFile, {})
      const at = Number(body.at)
      if (body.clear === true) {
        delete all[key]
        try {
          writeJson(progressFile, all)
        } catch {
          /* 忽略 */
        }
        return sendJson(res, 200, { ok: true, cleared: true })
      }
      if (!Number.isFinite(at) || at < 0) return sendJson(res, 200, { ok: false, error: '进度无效' })
      all[key] = { at: Math.round(at), duration: Math.round(Number(body.duration) || 0), at_ms: Date.now() }
      try {
        writeJson(progressFile, all)
      } catch (err) {
        log(`写进度失败：${err?.message || err}`)
        return sendJson(res, 200, { ok: false, error: '写入失败' })
      }
      return sendJson(res, 200, { ok: true, progress: all[key] })
    }

    if (method === 'POST' && path === '/login/start') {
      try {
        const j = await biliJson(
          'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header',
        )
        const data = j?.data
        if (!data?.qrcode_key || !data?.url) throw new Error('B 站没有返回二维码')
        loginKey = data.qrcode_key
        return sendJson(res, 200, { ok: true, key: loginKey, qr: renderQrSvg(data.url), url: data.url })
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: String(err?.message || err) })
      }
    }

    if (method === 'POST' && path === '/login/poll') {
      const body = await readJsonBody(req).catch(() => ({}))
      const key = body.key || loginKey
      if (!key) return sendJson(res, 200, { ok: false, state: 'idle', error: '还没开始扫码' })
      try {
        const res0 = await fetch(
          `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header`,
          { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(15000) },
        )
        const jar = pickCookies(typeof res0.headers.getSetCookie === 'function' ? res0.headers.getSetCookie() : [])
        let pollBody = {}
        try {
          pollBody = await res0.json()
        } catch {
          /* poll 偶尔返回空体 */
        }
        const code = pollBody?.data?.code
        if (code === 0) {
          const cred = await ensureBuvid3(jar)
          if (!cred.sessdata) {
            return sendJson(res, 200, { ok: false, state: 'unknown', error: '扫码成功但没拿到 SESSDATA，再扫一次' })
          }
          credential = { ...cred, savedAt: Date.now() }
          try {
            writeJson(credentialFile, credential)
            harden(credentialFile)
          } catch (err) {
            log(`写凭证失败：${err?.message || err}`)
          }
          loginKey = ''
          accountCache = null
          resolveCache = null
          const account = await getAccount(true)
          return sendJson(res, 200, { ok: true, state: 'ok', account })
        }
        const map = { 86101: 'waiting', 86090: 'scanned', 86038: 'expired' }
        const state = map[code] || 'unknown'
        if (state === 'expired') loginKey = ''
        return sendJson(res, 200, { ok: state !== 'expired', state, code, message: pollBody?.message || '' })
      } catch (err) {
        return sendJson(res, 200, { ok: false, state: 'unknown', error: String(err?.message || err) })
      }
    }

    if (method === 'POST' && path === '/logout') {
      credential = null
      loginKey = ''
      accountCache = null
      resolveCache = null
      try {
        writeJson(credentialFile, {})
      } catch {
        /* 忽略 */
      }
      return sendJson(res, 200, { ok: true, account: { loggedIn: false } })
    }

    if (method === 'GET' && path === '/resolve') {
      const force = url.searchParams.get('force') === '1'
      try {
        const result = await resolveSource(force)
        return sendJson(res, 200, { ok: result.ok !== false, media: result, error: result.error || '', config })
      } catch (err) {
        return sendJson(res, 200, {
          ok: false,
          error: explainBiliError(err),
          code: typeof err?.code === 'number' ? err.code : 0,
          risk: Boolean(err?.risk),
        })
      }
    }

    /*
     * HEAD 也要接：浏览器加载媒体前常先发 HEAD 探测「多大 / 支不支持 Range」。
     * 之前只放行 GET，HEAD 落到 404，浏览器就判定该资源不可随机访问 ——
     * 表现是能顺序播放但 seekable=[0,0]，拖进度条视频不跳。
     */
    if ((method === 'GET' || method === 'HEAD') && path === '/proxy') {
      return handleProxy(req, res, url)
    }

    return sendJson(res, 404, { ok: false, error: `unknown ${method} ${path}` })
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          const isProxy = (req.url || '').startsWith(API_PREFIX + '/proxy')

          /*
           * /proxy 是给 <video> 用的「媒体」端点，和 JSON 接口的信任模型不同：
           *  · 桌面版页面源是 dsh-app://app，请求本机 http 端口时 Origin 就是
           *    dsh-app://app，按同源规则一定不匹配 —— 但它确实是本应用自己。
           *  · 媒体元素不携带我们的认证 cookie，也不能自定义头，所以 DSH 的
           *    信任栅栏也会把它判为「未认证」。这不是漏洞，是 <video> 的固有限制。
           *  它的安全边界改为：只监听 127.0.0.1 + URL 带 HMAC 签名 + 目标域名
           *  白名单（handleProxy 本身就会验签并校验域名）。
           */
          if (isProxy) {
            const host = String(req.headers.host || '')
            if (host && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) {
              sendJson(res, 403, { ok: false, error: '只接受本机请求' })
              return
            }
            res.setHeader('access-control-allow-origin', '*')
            res.setHeader('access-control-allow-headers', 'range,if-range')
            res.setHeader('access-control-expose-headers', 'content-range,content-length,accept-ranges')
            if ((req.method || 'GET') === 'OPTIONS') {
              res.writeHead(204, { 'access-control-max-age': '600' })
              res.end()
              return
            }
            try {
              await handle(req, res, new URL(req.url || '/', 'http://127.0.0.1'))
            } catch (err) {
              if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(err?.message || err) })
              else res.end()
            }
            return
          }

          if (fenceReject(req, res)) return
          if (!sameOriginOk(req)) {
            sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
            return
          }
          try {
            await handle(req, res, new URL(req.url || '/', 'http://127.0.0.1'))
          } catch (err) {
            if (!res.headersSent) sendJson(res, 500, { ok: false, error: String(err?.message || err) })
            else res.end()
          }
        },
      }),
    'bili-wallpaper: /api/bili-wallpaper 路由',
  )

  log(`已加载（家目录 ${dir}${existsSync(configFile) ? '' : '，首次使用'}）`)
}