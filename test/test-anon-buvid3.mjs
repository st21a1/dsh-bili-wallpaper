/**
 * 验证：未登录（没有凭证）时，插件的 B 站请求也带上了 buvid3 设备指纹。
 * 用法：node test/test-anon-buvid3.mjs
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

const realFetch = globalThis.fetch
const seen = [] // 记录每个 B 站接口请求带的 cookie

globalThis.fetch = async (url, init) => {
  const u = String(url)
  const cookie = (init?.headers && init.headers.cookie) || ''
  if (u.includes('api.bilibili.com/x/web-interface/view')) seen.push({ api: 'view', cookie })
  if (u.includes('api.bilibili.com/x/player/playurl')) seen.push({ api: 'playurl', cookie })
  if (u.includes('api.bilibili.com/x/frontend/finger/spi')) seen.push({ api: 'spi', cookie })
  return realFetch(url, init)
}

const home = mkdtempSync(join(tmpdir(), 'bw-anon-'))
process.env.DSH_HOME = home

let handler = null
apply({
  effect(fn) {
    fn()
    return () => {}
  },
  get: () => undefined,
  webServer: {
    register(r) {
      handler = r.handler
      return () => {}
    },
  },
  logger: { info: () => {} },
})

const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const base = `${origin}/api/bili-wallpaper`
const H = { 'content-type': 'application/json', origin }

// 确认未登录
const st = await (await fetch(`${base}/state`, { headers: H })).json()
check('当前未登录（验证前提）', st.account?.loggedIn === false)

await fetch(`${base}/config`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', enabled: true }),
})
const rv = await (await fetch(`${base}/resolve?force=1`, { headers: H })).json()
check('匿名也能解析视频', rv.ok === true, (rv.media?.title || rv.error || '').slice(0, 30))

const view = seen.find((x) => x.api === 'view')
const playurl = seen.find((x) => x.api === 'playurl')

check('已请求过 view 接口', Boolean(view))
check('未登录时 view 请求带 buvid3', Boolean(view && /buvid3=[^;]+/.test(view.cookie)), view ? view.cookie || '(空)' : '-')
check('未登录时 playurl 请求带 buvid3', Boolean(playurl && /buvid3=[^;]+/.test(playurl.cookie)), playurl ? playurl.cookie : '-')
check('没有误带 SESSDATA', ![view, playurl].some((x) => x && x.cookie.includes('SESSDATA')))

server.close()
globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)