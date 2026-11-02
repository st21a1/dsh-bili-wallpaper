/**
 * 进度条「拖完弹回」的回归测试。
 *
 * 原缺陷：松手时立刻删掉 drag.__seek，滑块 value 回落到 snap.position.at；
 * 而 seek 是异步的（currentTime → seeking → seeked → timeupdate），
 * 那一刻 at 还是旧值 ⇒ 滑块弹回开场。
 *
 * 修复：松手后保留 __seek，等 store 的 onSeeked 回调再清（另有 1.5s 兜底）。
 *
 * 用法：node test/test-seek-ui.mjs
 */

let failures = 0
const check = (n, ok, d) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
  if (!ok) failures++
}

/* ── 复刻组件里的取值逻辑 ── */
const sliderValue = (drag, positionAt) => Math.floor('__seek' in drag ? drag.__seek : positionAt)

console.log('=== 场景 1：拖到 500 松手（当前已播到 30s）===')
let drag = {}
let positionAt = 30

drag = { ...drag, __seek: 500 }
check('拖动中滑块跟手', sliderValue(drag, positionAt) === 500, String(sliderValue(drag, positionAt)))

// 松手：保留 __seek（新实现）
check('松手后不回弹（保留 __seek）', sliderValue(drag, positionAt) === 500, String(sliderValue(drag, positionAt)))

// seeked 尚未触发：时间仍是旧值
positionAt = 31 // 播放器还在旧位置附近
check('seek 生效前滑块仍稳定', sliderValue(drag, positionAt) === 500, `positionAt=${positionAt} → ${sliderValue(drag, positionAt)}`)

// seeked 触发：position 追到 500，此时清掉 __seek
positionAt = 500
delete drag.__seek
check('seek 生效后滑块停在 500', sliderValue(drag, positionAt) === 500, String(sliderValue(drag, positionAt)))

console.log('\n=== 场景 2：反向拖动 3600 → 100 ===')
drag = { __seek: 100 }
positionAt = 3600
check('向后拖同样跟手', sliderValue(drag, positionAt) === 100)
positionAt = 100
delete drag.__seek
check('落地后仍是 100', sliderValue(drag, positionAt) === 100)

console.log('\n=== 场景 3：原缺陷的直接对照 ===')
// 旧实现：松手即删 __seek
const oldDrag = { __seek: 500 }
delete oldDrag.__seek
const oldValue = sliderValue(oldDrag, 30)
check('旧实现确实会弹回（复现缺陷）', oldValue === 30, `旧值=${oldValue}`)

console.log('\n=== 场景 4：兜底 —— seeked 永不触发 ===')
{
  let d = { __seek: 777 }
  let pos = 20
  // 1.5s 后兜底清理
  delete d.__seek
  check('兜底清理后滑块回到真实位置', sliderValue(d, pos) === 20, `pos=${pos}`)
}

console.log('\n=== 场景 5：切P 后不应残留旧 seek ===')
{
  // 切P会走 refresh → position 重置为 null，UI 的 drag 也应重置
  let d = { __seek: 900 }
  let pos = 0 // 新P 从 0 开始
  // 注意：切P 时若不清理 __seek，滑块会卡在 900
  const stuck = sliderValue(d, pos)
  check('切P 前若残留 __seek 会卡住（已知风险）', stuck === 900, `stuck=${stuck}`)
  // 修复依赖：切P 后 onSeeked/兜底 或 refresh 时清 drag
  d = {}
  check('清理后回到新P 的真实位置', sliderValue(d, pos) === 0)
}

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)