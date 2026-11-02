/**
 * 复现 -351：走插件自己的 Host 路由解析这个视频。
 * 用法：node test/repro-351.mjs
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const home = mkdtempSync(join(tmpdir(), 'bw-351-'))
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

const sources = [
  'https://www.bilibili.com/video/BV1S3sd6zEqt/?spm_id_from=333.1387.homepage.video_card.click&vd_source=562dc1e20c0b910968a3f4677dd8dbe8',
  'https://www.bilibili.com/video/BV1S3sd6zEqt',
  'BV1S3sd6zEqt',
]

for (const src of sources) {
  await fetch(`${base}/config`, { method: 'POST', headers: H, body: JSON.stringify({ source: src, enabled: true }) })
  const r = await (await fetch(`${base}/resolve?force=1`, { headers: H })).json()
  const m = r.media || {}
  console.log(`\n来源: ${src.slice(0, 60)}${src.length > 60 ? '…' : ''}`)
  console.log(`  ok=${r.ok} error="${r.error}"`)
  console.log(`  title=${(m.title || '').slice(0, 40)} | quality=${m.quality} | 档位=${(m.qualities || []).length}`)
}

server.close()
rmSync(home, { recursive: true, force: true })
setTimeout(() => process.exit(0), 100)