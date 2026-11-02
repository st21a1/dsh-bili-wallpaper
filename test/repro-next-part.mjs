/**
 * 复现「播完不跳下一P」：走真实 Host + 真实 B 站接口，
 * 模拟客户端 onEnded 的 next 分支，检查切换后拿到的 url 是否真的变了。
 *
 * 用法：node test/repro-next-part.mjs
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'bw-next-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })

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

const j = async (p, init) => (await fetch(base + p, { headers: H, ...init })).json()

// 1) 初始：P1
await j('/config', { method: 'POST', body: JSON.stringify({ source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', enabled: true, page: 1 }) })
const m1 = (await j('/resolve?force=1')).media
console.log('P1:')
console.log('  page =', m1.page, '| cid =', m1.cid)
console.log('  url  =', decodeURIComponent(m1.url).slice(0, 90))

// 2) 客户端 onEnded 的 next 分支做的事：patch({page:2}) 然后 refresh(force=true)
await j('/config', { method: 'POST', body: JSON.stringify({ page: 2 }) })
const m2 = (await j('/resolve?force=1')).media
console.log('\n切到 P2 后:')
console.log('  page =', m2.page, '| cid =', m2.cid)
console.log('  url  =', decodeURIComponent(m2.url).slice(0, 90))

console.log('\n=== 判定 ===')
console.log('  page 变了吗 :', m1.page !== m2.page ? '是' : '否 ← 问题')
console.log('  cid 变了吗  :', m1.cid !== m2.cid ? '是' : '否 ← 问题')
console.log('  url 变了吗  :', m1.url !== m2.url ? '是' : '否 ← 问题（客户端不会换源）')

// 3) 再模拟一次：不带 force（客户端 refresh 若没传 force 会走缓存）
const m3 = (await j('/resolve')).media
console.log('\n不带 force 的 /resolve:')
console.log('  page =', m3.page, '| 与 P2 相同:', m3.url === m2.url)

server.close()
rmSync(home, { recursive: true, force: true })
setTimeout(() => process.exit(0), 100)