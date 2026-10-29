/**
 * 确认 client.js 里内联的 hls.js 真的被读到了（HlsCtor 不是 null）。
 * 做法：给沙箱全局装一个记录型 Hls 属性，跑一遍模块工厂后看它被赋过什么。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const React = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
}

let registered = null
const mkEl = () => ({
  style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' }, getPropertyPriority() { return '' } },
  dataset: {},
  setAttribute() {}, removeAttribute() {}, hasAttribute() { return false },
  appendChild() {}, insertBefore() {}, remove() {}, addEventListener() {},
  isConnected: true, firstChild: null, firstElementChild: null,
})
const sandbox = {
  console,
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  addEventListener() {}, removeEventListener() {},
  navigator: { language: 'zh-CN' },
  MutationObserver: class { observe() {} disconnect() {} },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, config: {}, account: {} }) }),
  URL, TextEncoder, TextDecoder, Promise, Math, Date, JSON, Object,
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
sandbox.document = {
  head: mkEl(), body: mkEl(), documentElement: mkEl(),
  createElement: mkEl, getElementById: () => null,
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
}
sandbox.window.__ModuleLoader__ = { load: (def) => { registered = def } }
sandbox.__ModuleLoader__ = sandbox.window.__ModuleLoader__

// 记录 hls 是否被挂上来过（UMD 会写 globalThis.Hls，随后模块会删掉）
let sawHls = false
let held = undefined
Object.defineProperty(sandbox, 'Hls', {
  configurable: true,
  get: () => held,
  set: (v) => {
    held = v
    if (typeof v === 'function') sawHls = true
  },
})

vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })

const mod = registered.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected require ' + id)
})

const ctx = {
  effect(fn) { const c = fn(); return () => { try { c && c() } catch {} } },
  get(name) {
    if (name === 'slots') return { inject(k, cb) { cb() }, register: () => () => {} }
    return undefined
  },
}
mod.apply(ctx)

console.log('hls 挂载成功：', sawHls, '| isSupported:', typeof held?.isSupported === 'function' ? held.isSupported : 'n/a', '| 版本:', held?.version || 'n/a')
console.log('模块结束时是否已清理全局 Hls：', !('Hls' in sandbox) || typeof sandbox.Hls === 'undefined' ? '是' : '否')
if (!sawHls) {
  console.error('内联的 hls.js 没有挂上 globalThis.Hls —— 直播会退回原生 <video> 直连')
  process.exit(1)
}