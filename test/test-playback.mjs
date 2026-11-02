/**
 * 分P / 播完动作 / 进度记忆 的回归测试。
 *
 * 覆盖：
 *   ① Host 返回 parts 列表（多P视频）
 *   ② 配置默认 endAction=next、resume=true、page 合法化
 *   ③ /progress 读写与清除
 *   ④ 续播键按 视频+分P 区分（单P 与 P2 互不覆盖）
 *   ⑤ 切P 走 config.page 生效
 *
 * 用法：node test/test-playback.mjs
 */
import { apply, normalizeConfig } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

/* ① 配置默认值与合法化 */
const d = normalizeConfig({})
check('默认 endAction=next', d.endAction === 'next', d.endAction)
check('默认 resume=true', d.resume === true, String(d.resume))
check('默认 page=1', d.page === 1, String(d.page))
check('非法 endAction 被丢弃', normalizeConfig({ endAction: 'nonsense' }).endAction === 'next')
check('合法 endAction 保留', normalizeConfig({ endAction: 'hide' }).endAction === 'hide')
check('page 向下取整', normalizeConfig({ page: 3.7 }).page === 4)
check('page 小于 1 时拒绝', normalizeConfig({ page: 0 }).page === 1)

/* ② 起一个真 Host */
const home = mkdtempSync(join(tmpdir(), 'bw-playback-'))
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

/* ③ 多P视频：应返回 parts */
await j('/config', {
  method: 'POST',
  body: JSON.stringify({ source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', enabled: true }),
})
const rv = await j('/resolve?force=1')
const m = rv.media || {}
check('解析多P视频成功', m.ok === true, (m.title || rv.error || '').slice(0, 30))
check('返回了 parts 列表', Array.isArray(m.parts) && m.parts.length > 1, `${m.parts?.length} 个分P`)
check('parts 每项含 page/cid/title', Boolean(m.parts?.[0]?.page && m.parts?.[0]?.cid && m.parts?.[0]?.title))
check('当前 page=1', Number(m.page) === 1, String(m.page))

/* ④ 切P */
await j('/config', { method: 'POST', body: JSON.stringify({ page: 2 }) })
const rv2 = await j('/resolve?force=1')
check('切到 P2 后 page=2', Number(rv2.media?.page) === 2, String(rv2.media?.page))
check('P2 cid 与 P1 不同', rv2.media?.cid !== m.cid, `${m.cid} → ${rv2.media?.cid}`)

/* ⑤ 进度读写 */
const key = 'video:BV1S3sd6zEqt:p2'
let p = await j('/progress', { method: 'POST', body: JSON.stringify({ key, at: 1234, duration: 5000 }) })
check('写入进度成功', p.ok === true && p.progress?.at === 1234, JSON.stringify(p.progress))
p = await j('/progress?key=' + encodeURIComponent(key))
check('读回进度', p.progress?.at === 1234, JSON.stringify(p.progress))
check('读回带时长', p.progress?.duration === 5000)

/* ⑥ 键隔离：单P键与 P2 键互不影响 */
const keySingle = 'video:BV1S3sd6zEqt'
await j('/progress', { method: 'POST', body: JSON.stringify({ key: keySingle, at: 99, duration: 5000 }) })
const p2 = await j('/progress?key=' + encodeURIComponent(key))
const ps = await j('/progress?key=' + encodeURIComponent(keySingle))
check('P2 进度未被单P覆盖', p2.progress?.at === 1234, String(p2.progress?.at))
check('单P 进度独立保存', ps.progress?.at === 99, String(ps.progress?.at))

/* ⑦ 清除 */
p = await j('/progress', { method: 'POST', body: JSON.stringify({ key, clear: true }) })
check('清除进度', p.ok === true && p.cleared === true)
p = await j('/progress?key=' + encodeURIComponent(key))
check('清除后读不到', p.progress === null, String(p.progress))

/* ⑧ 非法进度被拒 */
p = await j('/progress', { method: 'POST', body: JSON.stringify({ key, at: -5 }) })
check('负进度被拒绝', p.ok === false, p.error)

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 100)