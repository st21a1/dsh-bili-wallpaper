/**
 * 离线自测（不装进 profile）：用假 ctx 起 Host 半端，直接打路由。
 *   node test/test-host.mjs
 *
 * 会用临时 DSH_HOME，不碰真实的配置与凭证。
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const home = mkdtempSync(join(tmpdir(), 'bw-test-'))
process.env.DSH_HOME = home

const routes = []
let handler = null
let failures = 0

const ctx = {
  effect(fn) {
    const cleanup = fn()
    return () => {
      try {
        cleanup && cleanup()
      } catch {
        /* ignore */
      }
    }
  },
  get: () => undefined,
  webServer: {
    register(route) {
      routes.push(route)
      handler = route.handler
      return () => {}
    },
  },
  logger: { info: (m) => console.log('HOST:', m) },
}

const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

apply(ctx)
check('注册了 /api/bili-wallpaper 前缀路由', routes.length === 1 && routes[0].path === '/api/bili-wallpaper')

const server = createServer((req, res) => {
  if (handler) return handler(req, res)
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const base = origin + '/api/bili-wallpaper'
const headers = { 'content-type': 'application/json', origin }

async function json(path, init) {
  const res = await fetch(base + path, { headers, ...init })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 200)
  }
  return { status: res.status, body }
}

const absolute = (url) => (url && url.startsWith('/') ? origin + url : url)

/* ① 初始状态 */
const st = await json('/state')
check('GET /state 默认关闭', st.status === 200 && st.body.config.enabled === false)
check('默认配置字段齐全', Object.keys(st.body.config).length >= 10)

/* ② 视频 */
await json('/config', {
  method: 'POST',
  body: JSON.stringify({ source: 'https://www.bilibili.com/video/BV1GJ411x7h7', enabled: true }),
})
const rv = await json('/resolve?force=1')
const media = rv.body.media || {}
check('解析视频', media.kind === 'video' && Boolean(media.url), media.title || rv.body.error)
check('视频给出清晰度表', Array.isArray(media.qualities) && media.qualities.length > 0)
if (media.url) {
  const r = await fetch(absolute(media.url), { headers: { range: 'bytes=0-1023' } })
  const bytes = await r.arrayBuffer()
  check('视频走代理可 Range 取流', (r.status === 206 || r.status === 200) && bytes.byteLength > 0, `HTTP ${r.status} / ${bytes.byteLength}B`)
}

/* ③ 直播 */

const list = await (await fetch('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getList?platform=web', { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/' } })).json()
const liveRoom = (list.data?.recommend_room_list || [])[0]
await json('/config', { method: 'POST', body: JSON.stringify({ source: 'https://live.bilibili.com/' + liveRoom.roomid, quality: 0 }) })
const rl = await json('/resolve?force=1')
const live = rl.body.media || {}
check('解析直播', live.kind === 'live' && (Boolean(live.url) || Boolean(live.offline)), live.title || rl.body.error || '未开播（可接受）')
if (live.url) {
  const r = await fetch(absolute(live.url))
  const text = await r.text()
  const proxied = text.split('\n').filter((l) => l.includes('/api/bili-wallpaper/proxy?'))
  check('HLS 清单被改写成代理地址', r.status === 200 && proxied.length > 0, `${proxied.length} 个分片`)
  if (proxied.length) {
    const r2 = await fetch(absolute(proxied[0]), { headers: { range: 'bytes=0-999' } })
    check('直播分片走代理可取', r2.status === 200 || r2.status === 206, `HTTP ${r2.status}`)
  }
}

/* ④ 安全边界 */
check('代理拒绝坏签名', (await json('/proxy?u=abc&t=deadbeef')).status === 403)
const evil = Buffer.from('https://example.com/x.ts').toString('base64url')
check('代理拒绝非 B 站域名', (await json(`/proxy?k=live&u=${evil}&t=x`)).status === 403)
const missing = await fetch(base + '/state', { headers: { origin: 'http://evil.example.com' } })
check('拒绝非同源 Origin', missing.status === 403, `HTTP ${missing.status}`)

/* ⑤ 扫码登录 */
const login = await json('/login/start', { method: 'POST', body: '{}' })
check('能出登录二维码', login.body.ok === true && String(login.body.qr || '').startsWith('data:image/svg+xml'), String(login.body.error || ''))
if (login.body.ok) {
  const poll = await json('/login/poll', { method: 'POST', body: JSON.stringify({ key: login.body.key }) })
  check('轮询返回等待状态', poll.body.state === 'waiting' || poll.body.state === 'scanned', poll.body.state)
}

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)