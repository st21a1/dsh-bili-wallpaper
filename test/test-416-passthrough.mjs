/**
 * 验证：越界 Range 时，代理应透传 416 而不是 502。
 *
 * 浏览器会向文件末尾附近发探测 Range；502 会让 Chrome 判定整体不可 seek。
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (n, ok, d) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
  if (!ok) failures++
}

const home = mkdtempSync(join(tmpdir(), 'bw-416-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })
writeFileSync(
  join(home, 'bili-wallpaper', 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', page: 1 }),
)

const TOTAL = 190607557
const realFetch = globalThis.fetch
let mode = 'normal'

globalThis.fetch = async (url, init) => {
  const u = String(url)
  const isMedia = /bilivideo\.(com|cn)|szbdwy|akamaized/.test(u)
  if (!isMedia) return realFetch(url, init)

  const range = String(init?.headers?.range || '')
  const m = /bytes=(\d+)-(\d*)/.exec(range)

  if (m) {
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : TOTAL - 1
    if (a >= TOTAL) {
      // 越界：真 B 站回 416
      return new Response('', {
        status: 416,
        headers: { 'content-type': 'text/plain', 'content-range': `bytes */${TOTAL}` },
      })
    }
    const end = Math.min(b, TOTAL - 1)
    return new Response(new Uint8Array(end - a + 1), {
      status: 206,
      headers: { 'content-type': 'video/mp4', 'content-range': `bytes ${a}-${end}/${TOTAL}`, 'content-length': String(end - a + 1) },
    })
  }
  return new Response(new Uint8Array(1024), {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(TOTAL), 'accept-ranges': 'bytes' },
  })
}

let handler = null
apply({
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
  webServer: { register(r) { handler = r.handler; return () => {} } },
  logger: { info() {} },
})
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const rv = await (await fetch(origin + '/api/bili-wallpaper/resolve?force=1', { headers: { origin } })).json()
const mediaUrl = origin + rv.media.url

/* ① 正常范围内 */
console.log('=== ① 范围内 Range ===')
const r1 = await fetch(mediaUrl, { headers: { origin, range: 'bytes=1000-1999' } })
await r1.arrayBuffer()
check('范围内返回 206', r1.status === 206, String(r1.status))
check('带 Content-Length', Boolean(r1.headers.get('content-length')), r1.headers.get('content-length'))

/* ② 越界（模拟浏览器探测末尾） */
console.log('\n=== ② 越界 Range（浏览器探测文件末尾）===')
const r2 = await fetch(mediaUrl, { headers: { origin, range: 'bytes=200000000-200065535' } })
await r2.arrayBuffer()
console.log('  status:', r2.status)
console.log('  content-range:', r2.headers.get('content-range'))
console.log('  accept-ranges:', r2.headers.get('accept-ranges'))
check('越界时透传 416（不是 502）', r2.status === 416, `实际 ${r2.status}`)
check('416 仍声明 accept-ranges', (r2.headers.get('accept-ranges') || '').includes('bytes'), r2.headers.get('accept-ranges'))

/* ③ 恰好从文件末尾开始 */
console.log('\n=== ③ 从最后几个字节开始 ===')
const r3 = await fetch(mediaUrl, { headers: { origin, range: `bytes=${TOTAL - 100}-${TOTAL - 1}` } })
await r3.arrayBuffer()
check('末尾合法范围返回 206', r3.status === 206, String(r3.status))

server.close()
globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)