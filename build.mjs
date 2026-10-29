/**
 * 构建：把 hls.js 内联进 client.src.js，产出 client.js
 * ---------------------------------------------------------------
 * 浏览器半端不经过打包器（直接由 __ModuleLoader__ 取 fetch 到的文件），
 * 所以这里做一次最小的「文本拼接」：把 hls.light.min.js 整段塞到
 * `/*__HLS_INLINE__*\/` 处，它会挂 globalThis.Hls，随后立刻被读走并清掉。
 *
 * 用法：node build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(here + 'client.src.js', 'utf8')
const hls = readFileSync(here + 'vendor/hls.light.min.js', 'utf8')

const marker = '/*__HLS_INLINE__*/'
if (!src.includes(marker)) throw new Error('client.src.js 里找不到 ' + marker + ' 占位')

// hls.js 是 UMD：在 factory 里运行时没有 module/exports，会自己挂到 globalThis.Hls。
// 结尾的 sourceMappingURL 注释也一并去掉，避免浏览器去拉一个不存在的 .map。
const payload = '\n/* ---- hls.js (light build) ---- */\n' + hls.replace(/\/\/# sourceMappingURL=.*$/m, '') + '\n/* ---- hls.js end ---- */\n'

const out = src.replace(marker, payload)
writeFileSync(here + 'client.js', out, 'utf8')
console.log('client.js 已生成：', out.length, 'bytes（hls.js', hls.length, 'bytes）')