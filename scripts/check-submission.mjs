/**
 * 按 dsh-plugin.org 的收录要求逐条自查。
 * 用法：node scripts/check-submission.mjs
 */
import { readFileSync } from 'node:fs'
import https from 'node:https'

const here = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, here), 'utf8')

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

function get(host, path, tries = 8) {
  return new Promise(async (resolve, reject) => {
    for (let i = 1; i <= tries; i++) {
      try {
        const r = await new Promise((res, rej) => {
          const req = https.request(
            { host, path, method: 'GET', headers: { 'user-agent': 'check', accept: '*/*' }, timeout: 25_000 },
            (r) => {
              const chunks = []
              r.on('data', (c) => chunks.push(c))
              r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
            },
          )
          req.on('timeout', () => req.destroy(new Error('timeout')))
          req.on('error', rej)
          req.end()
        })
        resolve(r)
        return
      } catch (e) {
        if (i === tries) return reject(e)
        await new Promise((r) => setTimeout(r, 1500 * i))
      }
    }
  })
}

const pkg = JSON.parse(read('package.json'))
const readme = read('README.md')
const indexSrc = read('index.js')

/* ① 仓库公开 */
try {
  const r = await get('api.github.com', '/repos/st21a1/dsh-bili-wallpaper')
  const j = JSON.parse(r.body)
  check('仓库已公开', r.status === 200 && j.private === false, r.status === 200 ? `private=${j.private}` : `HTTP ${r.status}`)
  /* ② topic */
  check('已添加 GitHub topic：dsh-plugin', Array.isArray(j.topics) && j.topics.includes('dsh-plugin'), (j.topics || []).slice(0, 6).join(', ') + '…')
} catch (e) {
  check('仓库已公开', false, 'API 不可达：' + (e.message || e))
  check('已添加 GitHub topic：dsh-plugin', false, 'API 不可达')
}

/* ③ README 包含 install 命令（要求形如 dsh plugin --profile web add <包名>） */
const installRe = /dsh plugin --profile web add (dsh-bili-wallpaper|github:st21a1\/dsh-bili-wallpaper|\.)/
check('README 含 `dsh plugin --profile web add` 命令', installRe.test(readme))

/* ④ 导出 apply(ctx) */
check('插件导出 apply(ctx)', /export function apply\s*\(\s*ctx/.test(indexSrc))

/* ⑤ 根目录 package.json 含包名与版本 */
check('根目录 package.json 有 name/version', Boolean(pkg.name && pkg.version), `${pkg.name}@${pkg.version}`)

/* ⑥ NPM 包存在（决定能否进插件中心） */
try {
  const r = await get('registry.npmjs.org', `/${pkg.name}`)
  const j = JSON.parse(r.body)
  const latest = j['dist-tags']?.latest
  const same = latest === pkg.version
  check('NPM 包已发布且版本一致', r.status === 200 && same, r.status === 200 ? `registry=${latest} / 仓库=${pkg.version}` : `HTTP ${r.status}`)
  if (r.status === 200) {
    const tb = await get('registry.npmjs.org', `/${pkg.name}/-/${pkg.name}-${latest}.tgz`)
    check('NPM tarball 可下载', tb.status === 200, `HTTP ${tb.status}`)
  }
} catch (e) {
  check('NPM 包已发布且版本一致', false, 'registry 不可达：' + (e.message || e))
}

/* ⑦ 许可证 */
check('声明许可证', Boolean(pkg.license), pkg.license)

/* ⑧ 其他提交要素 */
check('README 有截图', /screenshot-settings\.png/.test(readme) && /screenshot-background\.png/.test(readme))
check('README 有兼容性说明', /## 兼容性/.test(readme))
check('README 有权限说明', /## 权限与数据/.test(readme))
check('README 有 profile 支持表', /## 支持的 profile/.test(readme))

const failed = checks.filter((c) => !c.ok)
console.log(failed.length ? `\n${failed.length} 项未通过` : '\n全部通过，可以提交')
process.exit(failed.length ? 1 : 0)