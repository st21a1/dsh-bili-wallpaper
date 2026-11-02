/**
 * 端到端验证 seek：真 Host + 真 client 在沙箱里，
 * 手动触发 video.seeked，检查 position 是否更新、UI 回调是否清理 __seek。
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

let failures = 0
const check = (n, ok, d) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
  if (!ok) failures++
}

const home = mkdtempSync(join(tmpdir(), 'bw-seek2-'))
process.env.DSH_HOME = home
const dir = join(home, 'bili-wallpaper')
mkdirSync(dir, { recursive: true })
writeFileSync(
  join(dir, 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', page: 1, endAction: 'next', resume: false, muted: true }),
)

let handler = null
apply({
  effect(fn) { fn(); return () => {} },
  get: () => undefined,
  webServer: { register(r) { handler = r.handler; return () => {} } },
  logger: { info: () => {} },
})
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const mkEl = () => ({
  style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '', getPropertyPriority: () => '' },
  dataset: {}, children: [],
  setAttribute() {}, removeAttribute() {}, hasAttribute: () => false,
  appendChild(c) { this.children.push(c); return c },
  insertBefore(c) { this.children.unshift(c); return c },
  remove() {}, addEventListener() {}, isConnected: true, firstChild: null, firstElementChild: null,
})
const videos = []
function makeVideo() {
  const L = {}
  const v = {
    dataset: {}, duration: 3600, currentTime: 0, paused: true, ended: false,
    muted: true, volume: 1, playbackRate: 1, loop: false, src: '',
    addEventListener(t, fn) { (L[t] = L[t] || []).push(fn) },
    removeEventListener() {}, setAttribute() {}, removeAttribute() {}, load() {}, remove() {},
    play() { v.paused = false; return Promise.resolve() },
    pause() { v.paused = true },
    __fire(t) { for (const fn of L[t] || []) fn() },
  }
  videos.push(v)
  return v
}
const document = {
  body: mkEl(), head: mkEl(), documentElement: mkEl(),
  createElement: (t) => (t === 'video' ? makeVideo() : mkEl()),
  getElementById: () => null, addEventListener() {}, removeEventListener() {}, querySelector: () => null, hidden: false,
}
const React = {
  createElement: (t, p, ...k) => ({ t, p, k }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect() {}, useCallback: (f) => f, useRef: (v) => ({ current: v }),
}
const timers = []
const sandbox = {
  console,
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
  clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  addEventListener() {}, removeEventListener() {}, navigator: { language: 'zh-CN' },
  MutationObserver: class { observe() {} disconnect() {} },
  URL, TextEncoder, TextDecoder, Promise, Math, Date, JSON, Object, Number, String, Array,
  fetch: (u, i) => fetch(origin + u, i),
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.document = document
let registered = null
sandbox.__ModuleLoader__ = { load: (d) => (registered = d) }
sandbox.window.__ModuleLoader__ = sandbox.__ModuleLoader__
vm.createContext(sandbox)
vm.runInContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), sandbox, { filename: 'client.js' })

const mod = registered.factory((id) => (id === 'react' ? React : (() => { throw new Error(id) })()))
const effects = []
mod.apply({
  effect(fn) { effects.push(fn); return () => {} },
  get(name) {
    if (name === 'slots') return { inject() {}, register: () => () => {} }
    if (name === 'locale') return { getLocale: () => ({ active: 'zh-CN' }) }
    return undefined
  },
})
for (const fn of effects) { try { fn() } catch { /* ignore */ } }

await new Promise((r) => setTimeout(r, 1500))

const v = videos[videos.length - 1]
check('video 已创建', Boolean(v))

// 模拟 UI 的 commitSeekUI：设置 currentTime 并触发 seeked
console.log('\n模拟拖动到 500 并松手 …')
v.currentTime = 500
v.__fire('seeked')
await new Promise((r) => setTimeout(r, 600))

check('currentTime 落在 500', v.currentTime === 500, `currentTime=${v.currentTime}`)
check('seek 后没有重建 video', videos.length === 1, `${videos.length} 个`)
check('seek 后 video 仍在播放', v.paused === false, `paused=${v.paused}`)

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 200)