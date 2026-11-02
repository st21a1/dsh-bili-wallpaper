import { apply } from '../index.js'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'bw-head-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'bili-wallpaper'), { recursive: true })
writeFileSync(join(home, 'bili-wallpaper', 'config.json'),
  JSON.stringify({ enabled: true, source: 'https://www.bilibili.com/video/BV1S3sd6zEqt', page: 1 }))
let handler = null
apply({ effect(fn){ fn(); return ()=>{} }, get: () => undefined,
  webServer: { register(r){ handler=r.handler; return ()=>{} } }, logger: { info(){} } })
const server = createServer((req,res)=>handler(req,res))
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin = `http://127.0.0.1:${server.address().port}`
const rv = await (await fetch(origin+'/api/bili-wallpaper/resolve?force=1',{headers:{origin}})).json()
const mediaUrl = origin + rv.media.url

let bad = 0
const check = (n, ok, d) => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); if(!ok) bad++ }

console.log('=== HEAD 请求 ===')
const h = await fetch(mediaUrl, { method: 'HEAD', headers: { origin } })
console.log('  status:', h.status)
console.log('  content-length:', h.headers.get('content-length'))
console.log('  accept-ranges:', h.headers.get('accept-ranges'))
console.log('  content-type:', h.headers.get('content-type'))
check('HEAD 返回 200', h.status === 200, String(h.status))
check('HEAD 有 content-length', Boolean(h.headers.get('content-length')), h.headers.get('content-length'))
check('HEAD 声明 accept-ranges: bytes', (h.headers.get('accept-ranges')||'').includes('bytes'), h.headers.get('accept-ranges'))

console.log('\n=== HEAD + Range ===')
const h2 = await fetch(mediaUrl, { method: 'HEAD', headers: { origin, range: 'bytes=0-1023' } })
console.log('  status:', h2.status, '| content-range:', h2.headers.get('content-range'))
check('HEAD+Range 返回 206', h2.status === 206, String(h2.status))

server.close(); rmSync(home,{recursive:true,force:true})
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
setTimeout(()=>process.exit(bad?1:0),100)
