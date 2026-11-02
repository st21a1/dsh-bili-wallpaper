/**
 * 验证代理在「上游 chunked（无 content-length）」时仍回正确的 Content-Length。
 *
 * 这是「拖进度条视频不跳」的根因：206 响应缺 Content-Length ⇒ 浏览器
 * seekable 归零 ⇒ currentTime 赋值被忽略。
 *
 * 做法：劫持 fetch，模拟 B 站 CDN 的两种响应：
 *   ① 206 + Content-Range，但**不带** Content-Length（chunked）
 *   ② 200 全量（忽略 Range）
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

const home = mkdtempSync(join(tmpdir(), 'bw-hdr2-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })
writeFileSync(
  join(home, 'bili-wallpaper', 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', page: 1 }),
)

/* 劫持 fetch：只拦「媒体代理目标」，B 站元数据接口照常走真网 */
const realFetch = globalThis.fetch
const TOTAL = 250629517
let mode = 'chunked206'

globalThis.fetch = async (url, init) => {
  const u = String(url)
  const isMedia = u.includes('bilivideo.com') || u.includes('bilivideo.cn') || u.includes('szbdwy') || u.includes('akamaized')
  if (!isMedia) return realFetch(url, init)

  const range = init?.headers?.range || ''
  const m = /bytes=(\d+)-(\d+)/.exec(String(range))

  if (mode === 'chunked206' && m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const body = new Uint8Array(b - a + 1)
    // 关键：故意**不设** content-length，模拟 chunked
    return new Response(body, {
      status: 206,
      headers: {
        'content-type': 'video/mp4',
        'content-range': `bytes ${a}-${b}/${TOTAL}`,
      },
    })
  }

  if (mode === 'ignoreRange') {
    // 忽略 Range，回 200 全量（也不带长度）
    return new Response(new Uint8Array(2048), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  }

  // 普通首帧
  return new Response(new Uint8Array(1024), {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': '1024', 'accept-ranges': 'bytes' },
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

/* ① 上游 chunked 206 */
mode = 'chunked206'
console.log('=== ① 上游返回 206 但不带 Content-Length（chunked）===')
const r1 = await fetch(mediaUrl, { headers: { origin, range: 'bytes=1000-1999' } })
const b1 = await r1.arrayBuffer()
console.log('  status:', r1.status)
console.log('  content-range:', r1.headers.get('content-range'))
console.log('  content-length:', r1.headers.get('content-length'))
console.log('  实际字节:', b1.byteLength)
check('仍返回 206', r1.status === 206, String(r1.status))
check('补上了 Content-Length', r1.headers.get('content-length') === '1000', r1.headers.get('content-length'))
check('Content-Length 与实际字节一致', Number(r1.headers.get('content-length')) === b1.byteLength, `${r1.headers.get('content-length')} vs ${b1.byteLength}`)
check('声明了 accept-ranges: bytes', (r1.headers.get('accept-ranges') || '').includes('bytes'), r1.headers.get('accept-ranges'))

/* ② 上游忽略 Range 回 200 */
mode = 'ignoreRange'
console.log('\n=== ② 上游忽略 Range，回 200 全量 ===')
const r2 = await fetch(mediaUrl, { headers: { origin, range: 'bytes=5000-5999' } })
const b2 = await r2.arrayBuffer()
console.log('  status:', r2.status)
console.log('  content-range:', r2.headers.get('content-range'))
console.log('  content-length:', r2.headers.get('content-length'))
check('不会返回非法的 200 + Content-Range 组合', !(r2.status === 200 && r2.headers.get('content-range')), `status=${r2.status} cr=${r2.headers.get('content-range')}`)

server.close()
globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)