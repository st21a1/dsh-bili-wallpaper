/**
 * 验证：媒体地址是绝对 http://，且从「非同源 Origin」（模拟 dsh-app://app）
 * 也能正常取到 206 + Range。
 *
 * 这是「拖进度条视频不跳」的根因修复：
 * 之前 <video src> 被解析成 dsh-app://app/api/...，Chromium 对自定义 scheme
 * 的媒体不做随机访问，seekable 恒为 [0,0]。
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

const home = mkdtempSync(join(tmpdir(), 'bw-abs-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })
writeFileSync(
  join(home, 'bili-wallpaper', 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', page: 1 }),
)

let handler = null
let ORIGIN = ''
apply({
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
  webServer: {
    register(r) { handler = r.handler; return () => {} },
    getOrigin() { return ORIGIN },
  },
  logger: { info() {} },
})
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
ORIGIN = `http://127.0.0.1:${server.address().port}`

const rv = await (await fetch(ORIGIN + '/api/bili-wallpaper/resolve?force=1', { headers: { origin: ORIGIN } })).json()
const url = rv.media.url

console.log('=== ① 媒体地址形态 ===')
console.log('  实际值:', String(url).slice(0, 90))
check('是绝对 http:// 地址', /^http:\/\/127\.0\.0\.1:\d+\/api\//.test(String(url)), String(url).slice(0, 60))
check('不再是相对路径', !String(url).startsWith('/'), String(url).slice(0, 30))

console.log('\n=== ② 从非本应用 Origin 请求（模拟 dsh-app://app）===')
const weirdOrigin = 'dsh-app://app'
const r1 = await fetch(url, { headers: { origin: weirdOrigin, range: 'bytes=0-1023' } })
const b1 = await r1.arrayBuffer()
console.log('  status:', r1.status)
console.log('  content-range:', r1.headers.get('content-range'))
console.log('  content-length:', r1.headers.get('content-length'))
console.log('  accept-ranges:', r1.headers.get('accept-ranges'))
console.log('  ACAO:', r1.headers.get('access-control-allow-origin'))
check('跨源也能取到媒体（不再 403）', r1.status === 206, String(r1.status))
check('带 Content-Range', Boolean(r1.headers.get('content-range')), r1.headers.get('content-range'))
check('带 Accept-Ranges: bytes', (r1.headers.get('accept-ranges') || '').includes('bytes'), r1.headers.get('accept-ranges'))
check('带 CORS 头', r1.headers.get('access-control-allow-origin') === '*', r1.headers.get('access-control-allow-origin'))
check('暴露 content-range 给 JS', (r1.headers.get('access-control-expose-headers') || '').includes('content-range'), r1.headers.get('access-control-expose-headers'))

console.log('\n=== ③ HEAD 探测（浏览器首帧会发）===')
const r2 = await fetch(url, { method: 'HEAD', headers: { origin: weirdOrigin } })
console.log('  status:', r2.status, '| content-length:', r2.headers.get('content-length'))
check('HEAD 正常', r2.status === 200, String(r2.status))

console.log('\n=== ④ 签名仍生效（安全边界没被放宽掉）===')
const bad = String(url).replace(/t=[^&]+/, 't=deadbeef')
const r3 = await fetch(bad, { headers: { origin: weirdOrigin, range: 'bytes=0-99' } })
console.log('  篡改签名后 status:', r3.status)
check('坏签名仍被拒', r3.status === 403, String(r3.status))

console.log('\n=== ⑤ 非白名单域名仍被拒 ===')
const evilU = Buffer.from('https://example.com/x.mp4').toString('base64url')
const r4 = await fetch(`${ORIGIN}/api/bili-wallpaper/proxy?k=video&u=${evilU}&t=x`, { headers: { origin: weirdOrigin } })
console.log('  非 B 站域名 status:', r4.status)
check('非白名单域名仍 403', r4.status === 403, String(r4.status))

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)