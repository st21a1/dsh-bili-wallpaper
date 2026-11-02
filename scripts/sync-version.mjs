// 把 index.js 里 /state 返回的版本号同步成 package.json 的版本
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const file = 'index.js'
let src = readFileSync(file, 'utf8')
const before = src
src = src.replace(/(version:\s*')[\d.]+(')/, `$1${pkg.version}$2`)
writeFileSync(file, src, 'utf8')

const now = /version:\s*'([\d.]+)'/.exec(src)
console.log(`index.js 版本: ${before === src ? '未变化' : '已更新'} → ${now ? now[1] : '?'}（package.json: ${pkg.version}）`)