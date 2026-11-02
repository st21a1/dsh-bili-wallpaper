/**
 * 回归：登录态的 cookie 里**不能**出现 buvid3。
 *
 * 背景（2026-11 实测）：`SESSDATA + buvid3` 会被 B 站判为「同一账号 + 陌生设备指纹」，
 * playurl 直接 -351；同一次请求去掉 buvid3 立刻 code=0。所以：
 *   - 登录请求：只带 SESSDATA / bili_jct / DedeUserID
 *   - 匿名请求：带 buvid3
 *
 * 用法：node test/test-cookie-composition.mjs
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

const home = mkdtempSync(join(tmpdir(), 'bw-cookie-'))
process.env.DSH_HOME = home

// 造一份「已登录」凭证
const dir = join(home, 'bili-wallpaper')
mkdirSync(dir, { recursive: true })
writeFileSync(
  join(dir, 'bili_credential.json'),
  JSON.stringify({
    sessdata: 'FAKE_SESSDATA_FOR_TEST',
    bili_jct: 'FAKE_JCT',
    dedeuserid: '12345',
    buvid3: 'FAKE-BUVID3-SHOULD-NOT-BE-SENT',
    savedAt: Date.now(),
  }),
)

/* 抓取真实发出的 cookie */
const realFetch = globalThis.fetch
const seen = []
globalThis.fetch = async (url, init) => {
  const u = String(url)
  const cookie = (init?.headers && init.headers.cookie) || ''
  if (u.includes('api.bilibili.com/x/web-interface/view')) seen.push({ api: 'view', cookie })
  if (u.includes('api.bilibili.com/x/player/playurl')) seen.push({ api: 'playurl', cookie })
  if (u.includes('api.bilibili.com/x/web-interface/nav')) seen.push({ api: 'nav', cookie })
  // 模拟 B 站：登录态里混进 buvid3 就返回 -351
  if (cookie.includes('FAKE-BUVID3-SHOULD-NOT-BE-SENT')) {
    return new Response(JSON.stringify({ code: -351, message: '受到神秘力量干扰，请稍后再试！' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return realFetch(url, init)
}

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

await fetch(`${base}/config`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', enabled: true }),
})
const rv = await (await fetch(`${base}/resolve?force=1`, { headers: H })).json()

check('登录态下能解析成功（不被 -351 拦）', rv.ok === true, (rv.media?.title || rv.error || '').slice(0, 30))

const loginCalls = seen.filter((x) => x.api === 'view' || x.api === 'playurl')
check('确实走了登录态请求', loginCalls.length >= 2, `${loginCalls.length} 次`)

for (const c of loginCalls) {
  check(`登录请求不带 buvid3（${c.api}）`, !c.cookie.includes('buvid3'), c.cookie.slice(0, 60))
}
check(
  '登录请求仍带 SESSDATA',
  loginCalls.every((c) => c.cookie.includes('SESSDATA=')),
  loginCalls[0]?.cookie.slice(0, 50),
)

server.close()
globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)