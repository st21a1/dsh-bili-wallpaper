/**
 * 验证 -351 风控处理：拦截 fetch，强制返回 -351，检查
 *   ① 是否真的退避重试（总共 1 次 + 3 次重试 = 4 次请求）
 *   ② 最终抛出的错误是否带 risk 标记
 *   ③ explainBiliError 是否给出人话提示
 *
 * 用法：node test/test-risk-351.mjs
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

/* ── 劫持全局 fetch，模拟 B 站风控 ── */
const realFetch = globalThis.fetch
let calls = 0
let mode = 'always351'

globalThis.fetch = async (url, init) => {
  const u = String(url)
  // 只拦 B 站接口，放行本地路由与 finger/spi
  if (u.includes('api.bilibili.com/x/web-interface/view') || u.includes('api.bilibili.com/x/player/playurl')) {
    calls++
    if (mode === 'always351') {
      return new Response(JSON.stringify({ code: -351, message: '受到神秘力量干扰，请稍后再试！' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (mode === 'failThenOk') {
      if (calls <= 2) {
        return new Response(JSON.stringify({ code: -351, message: '受到神秘力量干扰，请稍后再试！' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
    }
  }
  return realFetch(url, init)
}

const home = mkdtempSync(join(tmpdir(), 'bw-risk-'))
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

const setSource = (s) =>
  fetch(`${base}/config`, { method: 'POST', headers: H, body: JSON.stringify({ source: s, enabled: true }) })

/* ① 持续 -351：应重试 4 次后返回人话提示 */
await setSource('https://www.bilibili.com/video/BV1S3sd6zEqt')
calls = 0
mode = 'always351'
const t0 = Date.now()
const r1 = await (await fetch(`${base}/resolve?force=1`, { headers: H })).json()
const elapsed = Date.now() - t0

check('持续 -351 时会退避重试', calls === 4, `实际请求 ${calls} 次（期望 4）`)
check('重试确实有等待', elapsed > 4000, `${elapsed}ms`)
check('返回 ok=false', r1.ok === false)
check('返回 risk 标记', r1.risk === true)
check('错误码为 -351', r1.code === -351, `code=${r1.code}`)
check(
  '给出可读解释而非原始报错',
  typeof r1.error === 'string' && r1.error.includes('风控') && !r1.error.startsWith('B站接口 -351'),
  r1.error.slice(0, 60) + '…',
)

/* ② 前两次 -351、第三次成功：应自动恢复 */
calls = 0
mode = 'failThenOk'
const r2 = await (await fetch(`${base}/resolve?force=1`, { headers: H })).json()
check('两次风控后第三次成功自动恢复', r2.ok === true, `请求 ${calls} 次`)
check('恢复后拿到标题', Boolean(r2.media?.title), (r2.media?.title || '').slice(0, 30))

server.close()
globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)