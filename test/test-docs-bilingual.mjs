/**
 * 校验中英双语文档：编码、链接、章节对齐、版本一致。
 */
import { readFileSync } from 'node:fs'

let failures = 0
const check = (n, ok, d) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
  if (!ok) failures++
}

const read = (f) => readFileSync(f, 'utf8')

const zhReadme = read('README.md')
const enReadme = read('README.en.md')
const zhLog = read('CHANGELOG.md')
const enLog = read('CHANGELOG.en.md')
const pkg = JSON.parse(read('package.json'))

/* 编码 */
for (const [name, text] of [
  ['README.md', zhReadme],
  ['README.en.md', enReadme],
  ['CHANGELOG.md', zhLog],
  ['CHANGELOG.en.md', enLog],
]) {
  const bad = (text.match(/\uFFFD/g) || []).length
  check(`${name} 无乱码`, bad === 0, bad ? `${bad} 个替换字符` : '')
}

/* 语言互链 */
check('中文 README 链到英文', zhReadme.includes('README.en.md'))
check('英文 README 链到中文', enReadme.includes('(README.md)'))
check('中文 CHANGELOG 链到英文', zhLog.includes('CHANGELOG.en.md'))
check('英文 CHANGELOG 链到中文', enLog.includes('(CHANGELOG.md)'))

/* README 章节对齐（中文标题数 vs 英文 ## 数） */
const zhSections = (zhReadme.match(/^## /gm) || []).length
const enSections = (enReadme.match(/^## /gm) || []).length
check('README 章节数一致', zhSections === enSections, `中文 ${zhSections} / 英文 ${enSections}`)

/* 关键内容两边都有 */
const mustHave = [
  ['npm 安装命令', 'dsh plugin --profile web add dsh-bili-wallpaper'],
  ['GitHub 安装命令', 'github:st21a1/dsh-bili-wallpaper'],
  ['许可证 MIT', 'MIT'],
  ['截图引用', 'screenshot-settings.png'],
]
for (const [label, needle] of mustHave) {
  check(`中文 README 含${label}`, zhReadme.includes(needle))
  check(`英文 README 含${label}`, enReadme.includes(needle))
}

/* 版本号一致 */
check('package.json 版本为 0.3.0', pkg.version === '0.3.0', pkg.version)
check('中文 CHANGELOG 有 0.3.0', zhLog.includes('## [0.3.0]'))
check('英文 CHANGELOG 有 0.3.0', enLog.includes('## [0.3.0]'))

/* 版本条目数一致 */
const zhVersions = (zhLog.match(/^## \[[\d.]+\]/gm) || []).map((s) => s.trim())
const enVersions = (enLog.match(/^## \[[\d.]+\]/gm) || []).map((s) => s.trim())
check('CHANGELOG 版本条目数一致', zhVersions.length === enVersions.length, `${zhVersions.length} / ${enVersions.length}`)
check('CHANGELOG 版本号集合一致', JSON.stringify(zhVersions) === JSON.stringify(enVersions), zhVersions.join(','))

/* package files 收录 */
check('package.json 收录 README.en.md', pkg.files.includes('README.en.md'))
check('package.json 收录 CHANGELOG.en.md', pkg.files.includes('CHANGELOG.en.md'))

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)