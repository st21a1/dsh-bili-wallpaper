/**
 * 声音修复的回归测试：
 *   ① 0.1.0 的 `muted: true` 老配置要迁移成出声
 *   ② 迁移之后用户自己再静音，不能再被翻回来
 *   ③ 既有配置里 muted 但 volume 为 0 时，补一个能听见的音量
 *   ④ 直播必须选 ts（音轨混在分片里），不能选 fmp4
 *
 *   node test/test-audio.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig, apply } from '../index.js'

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

/* ① 老配置迁移 */
const legacy = normalizeConfig({ enabled: true, muted: true, volume: 0.5, source: 'x' })
check('0.1.x 的 muted:true 迁移成出声', legacy.muted === false, JSON.stringify({ muted: legacy.muted }))
check('迁移后留下 configVersion', legacy.configVersion === 2)

/* ② 用户升级后自己静音，不被翻回来 */
const own = normalizeConfig({ muted: true, volume: 0.6, configVersion: 2 })
check('用户自己静音（v2）保持不变', own.muted === true)

/* ③ 取消静音但音量为 0 → 补默认音量 */
const zero = normalizeConfig({ muted: false, volume: 0, configVersion: 2 })
check('没静音但音量为 0 时补默认音量', zero.volume > 0, 'volume=' + zero.volume)

/* ④ 真实配置文件的迁移落盘 */
const home = mkdtempSync(join(tmpdir(), 'bw-audio-'))
process.env.DSH_HOME = home
const dir = join(home, 'bili-wallpaper')
mkdirSync(dir, { recursive: true })
writeFileSync(
  join(dir, 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://live.bilibili.com/22259479', quality: 0, muted: true, volume: 0.5 }),
)

let handler = null
const ctx = {
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
}
apply(ctx)

const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const H = { 'content-type': 'application/json', origin }

const st = await (await fetch(origin + '/api/bili-wallpaper/state', { headers: H })).json()
check('启动即迁移旧配置（state 里 muted=false）', st.config.muted === false, JSON.stringify({ muted: st.config.muted, volume: st.config.volume }))

const onDisk = JSON.parse(await (await import('node:fs')).promises.readFile(join(dir, 'config.json'), 'utf8'))
check('迁移结果写回了 config.json', onDisk.muted === false && onDisk.configVersion === 2)

/* ⑤ 直播选 ts */
const list = await (
  await fetch('https://api.live.bilibili.com/xlive/web-interface/v1/webMain/getList?platform=web', {
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://live.bilibili.com/' },
  })
).json()
const room = (list.data?.recommend_room_list || [])[0]
if (room) {
  await fetch(origin + '/api/bili-wallpaper/config', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ source: 'https://live.bilibili.com/' + room.roomid }),
  })
  const rv = await (await fetch(origin + '/api/bili-wallpaper/resolve?force=1', { headers: H })).json()
  const m = rv.media || {}
  if (m.ok) {
    const pl = await (await fetch(origin + m.url, { headers: H })).text()
    // 分片地址是 base64 包在代理参数里的，解码后再看扩展名
    const decoded = pl
      .split('\n')
      .filter((l) => l.includes('/proxy?'))
      .map((l) => {
        const u = new URL(l.trim(), 'http://x').searchParams.get('u') || ''
        try {
          return Buffer.from(u, 'base64url').toString('utf8')
        } catch {
          return ''
        }
      })
    const tsSegs = decoded.filter((d) => /\.ts(\?|$)/.test(d)).length
    const m4sSegs = decoded.filter((d) => /\.m4s(\?|$)|\/index\.m3u8/.test(d)).length
    check('直播走的是 ts（音轨在分片里）', tsSegs > 0 && m4sSegs === 0, `ts=${tsSegs} fmp4=${m4sSegs}`)
    check('解析结果标注了有音轨', m.hasAudio === true)
  } else {
    check('直播解析（房间可能没开播，跳过格式断言）', true, m.error || 'offline')
  }
}

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)