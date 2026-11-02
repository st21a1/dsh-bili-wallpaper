/**
 * 「播完跳下一P」的端到端回归。
 *
 * 曾经的问题是：next 分支在 patch() 之后又 await refresh(true) 一次，
 * 连续两次重建 video，刚启动的播放被打断 —— 表现为画面回到当前P 的开头。
 *
 * 本测试断言：触发一次 ended 后，只新建 **1** 个 video（= 只换源一次）。
 *
 * 用法：node test/test-next-part.mjs
 */
import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

const home = mkdtempSync(join(tmpdir(), 'bw-next2-'))
process.env.DSH_HOME = home
const dir = join(home, 'bili-wallpaper')
mkdirSync(dir, { recursive: true })
writeFileSync(
  join(dir, 'config.json'),
  JSON.stringify({
    enabled: true,
    source: 'https://www.bilibili.com/video/BV1S3sd6zEqt',
    page: 1,
    endAction: 'next',
    resume: true,
    muted: true,
  }),
)

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

/* 假 DOM */
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

const before = videos.length
const v1 = videos[videos.length - 1]
check('初始只有一个 video', before === 1, `${before} 个`)
check('初始 loop 为 false（endAction=next）', v1.loop === false, `loop=${v1.loop}`)

v1.currentTime = 3600
v1.__fire('ended')
await new Promise((r) => setTimeout(r, 3000))

const created = videos.length - before
check('换源后只新建 1 个 video（不多重建）', created === 1, `新建 ${created} 个`)
check('新 video 的 src 与旧的不同', videos[videos.length - 1].src !== v1.src, '')
check('新 video 自动开始播放', videos[videos.length - 1].paused === false, `paused=${videos[videos.length - 1].paused}`)

const st = await (await fetch(origin + '/api/bili-wallpaper/state', { headers: { origin } })).json()
check('后端 page 已切到 2', Number(st.config.page) === 2, `page=${st.config.page}`)

// 播完的 P1 不该留下进度记录
const progPath = join(dir, 'progress.json')
let prog = {}
try {
  prog = JSON.parse(readFileSync(progPath, 'utf8'))
} catch {
  prog = {}
}
const p1 = prog['video:BV1S3sd6zEqt']
check('播完的 P1 进度已被清除', !p1 || p1.at < 60, p1 ? `残留 ${Math.round(p1.at)}s` : '无记录')

server.close()
rmSync(home, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
setTimeout(() => process.exit(failures ? 1 : 0), 200)