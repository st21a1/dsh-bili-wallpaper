/**
 * 「播完之后」决策逻辑的纯函数测试。
 *
 * 不再模拟 DOM / 定时器（那层已证明不可靠），而是把决策逻辑抽成纯函数直接测。
 * 决策函数与 client.src.js 里的 onEnded 必须保持一致，改动时一起改。
 *
 * 用法：node test/test-end-decision.mjs
 */
import { readFileSync } from 'node:fs'

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

/**
 * 与 client.src.js 中 layer.onEnded 的决策部分同构：
 * 返回 { action: 'seek0' | 'play' | 'disable' | 'stop' | 'goto', page? }
 */
function decide(cfg, media) {
  const action = cfg.endAction || 'next'
  if (action === 'loop') return { action: 'seek0' }
  if (action === 'hide') return { action: 'disable' }
  if (action === 'stop') return { action: 'stop' }
  const parts = media && Array.isArray(media.parts) ? media.parts : []
  const cur = media ? Number(media.page) || 1 : 1
  const next = parts.find((p) => Number(p.page) > cur)
  return next ? { action: 'goto', page: Number(next.page) } : { action: 'stop' }
}

const P2 = {
  kind: 'video',
  page: 1,
  parts: [
    { page: 1, title: 'P1' },
    { page: 2, title: 'P2' },
    { page: 3, title: 'P3' },
  ],
}
const P1Only = { kind: 'video', page: 1, parts: [{ page: 1, title: 'only' }] }
const noParts = { kind: 'video', page: 1 }

/* loop */
check('loop → 回到开头', decide({ endAction: 'loop' }, P2).action === 'seek0')

/* stop */
check('stop → 停住', decide({ endAction: 'stop' }, P2).action === 'stop')

/* hide */
check('hide → 关闭背景', decide({ endAction: 'hide' }, P2).action === 'disable')

/* next：有多P */
let d = decide({ endAction: 'next' }, P2)
check('next → 跳到 P2', d.action === 'goto' && d.page === 2, JSON.stringify(d))

/* next：已在最后一P */
d = decide({ endAction: 'next' }, { ...P2, page: 3 })
check('next 在最后一P → 停住', d.action === 'stop', JSON.stringify(d))

/* next：单P视频 */
d = decide({ endAction: 'next' }, P1Only)
check('next 单P → 停住', d.action === 'stop', JSON.stringify(d))

/* next：拿不到 parts */
d = decide({ endAction: 'next' }, noParts)
check('next 无 parts → 停住（不崩）', d.action === 'stop', JSON.stringify(d))

/* 缺省 endAction 走 next */
d = decide({}, P2)
check('缺省 endAction 按 next 处理', d.action === 'goto' && d.page === 2)

/* 从中间P开始 next 也能正确往后走 */
d = decide({ endAction: 'next' }, { ...P2, page: 2 })
check('从 P2 → P3', d.action === 'goto' && d.page === 3, JSON.stringify(d))

/* ── 顺带核对源码里的实现与上面同构（防止测试与实现漂移）── */
const src = readFileSync(new URL('../client.src.js', import.meta.url), 'utf8')
const endedBlock = src.slice(src.indexOf('layer.onEnded'), src.indexOf('layer.onEnded') + 2000)

check('源码里 loop 分支调用 seek(0)', /action === 'loop'[\s\S]{0,220}seek\(0\)/.test(endedBlock))
check('源码里 hide 分支关闭 enabled', /action === 'hide'[\s\S]{0,200}enabled: false/.test(endedBlock))
check('源码里 stop 分支直接返回', /action === 'stop'[\s\S]{0,160}return/.test(endedBlock))
check('源码里 next 分支找更大 page', /p\.page\) > cur/.test(endedBlock) || /Number\(p\.page\) > cur/.test(endedBlock))
check('源码里播完会清掉该P进度', /clear: true/.test(endedBlock))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)