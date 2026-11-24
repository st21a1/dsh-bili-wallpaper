/**
 * 用真实 Host 验证直播间 213 能否解析，并取出封面等信息。
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'bw-213-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })

try {
  writeFileSync(
    join(home, 'bili-wallpaper', 'bili_credential.json'),
    readFileSync('C:/Users/Administrator/.dsh/bili-wallpaper/bili_credential.json', 'utf8'),
  )
  console.log('已复用登录凭证')
} catch {
  console.log('匿名模式')
}

writeFileSync(
  join(home, 'bili-wallpaper', 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://live.bilibili.com/213', quality: 0 }),
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
const m = rv.media || {}

console.log('\n=== 解析结果 ===')
console.log('ok        :', m.ok)
console.log('kind      :', m.kind)
console.log('live      :', m.live)
console.log('title     :', m.title)
console.log('owner     :', m.owner)
console.log('quality   :', m.quality)
console.log('hasAudio  :', m.hasAudio)
console.log('cover     :', m.cover)
console.log('note      :', m.note)
console.log('error     :', m.error)
console.log('url(kind) :', m.url ? '有' : '无')

if (m.cover) {
  try {
    const r = await fetch(m.cover, { headers: { referer: 'https://live.bilibili.com/', 'user-agent': 'Mozilla/5.0' } })
    console.log('封面可下载:', r.ok, r.status, (r.headers.get('content-type') || ''))
  } catch (e) {
    console.log('封面下载失败:', e.message)
  }
}

server.close()
rmSync(home, { recursive: true, force: true })
setTimeout(() => process.exit(m.ok ? 0 : 1), 200)