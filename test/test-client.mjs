// 校验 client.js 在「像浏览器」的沙箱里能跑：给出假 window/__ModuleLoader__/document
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
const listeners = {}
const el = () => ({ style: { setProperty(){}, removeProperty(){}, getPropertyValue(){return ''}, getPropertyPriority(){return ''} }, dataset: {}, setAttribute(){}, removeAttribute(){}, hasAttribute(){ return false }, appendChild(){}, insertBefore(){}, remove(){}, addEventListener(){}, isConnected: true, firstChild: null, firstElementChild: null, removeAttribute(){}, classList:{add(){},remove(){}} })
const head = el()
const body = el()
const document = {
  head, body,
  documentElement: el(),
  createElement: () => el(),
  getElementById: () => null,
  addEventListener(){}, removeEventListener(){},
  hasAttribute(){ return false },
  querySelector(){ return null },
}
const windowObj = {
  __ModuleLoader__: { load: (def) => { registered = def } },
  setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  addEventListener(){}, removeEventListener(){},
  navigator: { language: 'zh-CN' },
  document,
  MutationObserver: class { observe(){} disconnect(){} },
  console,
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, config: {}, account: {} }) }),
}
const sandbox = { window: windowObj, document, console, setTimeout: windowObj.setTimeout, clearTimeout: windowObj.clearTimeout, setInterval: windowObj.setInterval, clearInterval: windowObj.clearInterval, navigator: windowObj.navigator, MutationObserver: windowObj.MutationObserver, fetch: windowObj.fetch, globalThis: windowObj, URL, TextEncoder, TextDecoder, Promise, Math, Date, JSON }
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'client.js' })
console.log('module registered:', registered && registered.id)
const mod = registered.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected require ' + id)
})
console.log('inject:', mod.inject)
const effects = []
const registered_slots = []
const ctx = {
  effect(fn, label){ effects.push(label); const c = fn(); return () => { try { c && c() } catch(e){} } },
  get(name){ if (name==='slots') return { inject(key, cb){ cb() }, register(def, fn){ registered_slots.push(def.id + '@' + def.name); return () => {} } }; return undefined },
}
mod.apply(ctx)
console.log('effects:', effects)
console.log('slots:', registered_slots)
console.log('hls available in sandbox:', typeof sandbox.Hls === 'function', 'cleaned:', sandbox.Hls === undefined)


