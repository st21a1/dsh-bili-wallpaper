/**
 * 抓取真实运行界面截图（设置页 + 背景效果）。
 *
 * 复用插件自己的 Host 逻辑来验证直播间，再驱动无头 Edge 走真实 UI。
 *
 * 前置：
 *   1. 一个正在运行的 dsh web 实例，且该 profile 已安装本插件：
 *        dsh web --no-open
 *      从输出里拿到 http://127.0.0.1:<port>/?token=...
 *   2. Edge 装在默认路径（Windows）。
 *
 * 用法：
 *   DSH_BASE=http://127.0.0.1:3080 \
 *   DSH_TOKEN=<token> \
 *   SHOT_DIR=<输出目录> \
 *   node scripts/capture-screenshots.mjs
 *
 * 产出：
 *   real-settings.png    设置面板（裁到内容区）
 *   real-background.png  背景效果（整个界面）
 *
 * 之后自行缩放写入 assets/，例如 Pillow：
 *   Image.open('real-settings.png').resize((640, h), Image.LANCZOS)
 */
import { spawn } from 'node:child_process'
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.DSH_BASE
const TOKEN = process.env.DSH_TOKEN
const OUT = process.env.SHOT_DIR || process.cwd()
const PORT = Number(process.env.CDP_PORT || 9350)
const PROFILE = join(OUT, '_cdp-profile')

if (!BASE || !TOKEN) {
  console.error('需要 DSH_BASE 与 DSH_TOKEN')
  process.exit(1)
}
if (!existsSync(EDGE)) {
  console.error('找不到 Edge:', EDGE)
  process.exit(1)
}

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (existsSync(PROFILE)) rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--disable-gpu',
    '--window-size=1500,1400',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let wsUrl = ''
for (let i = 0; i < 40; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl
    if (wsUrl) break
  } catch {
    /* retry */
  }
  await sleep(500)
}
if (!wsUrl) {
  console.error('devtools 未就绪')
  edge.kill()
  process.exit(1)
}

/** 极简 CDP 客户端，只用到 page/input/screenshot 几个方法 */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ready = new Promise((res) => this.ws.addEventListener('open', () => res()))
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
}

const cdp = new CDP(wsUrl)
await cdp.ready
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
const sess = (m, p) => cdp.send(m, p, sessionId)

await sess('Page.enable')
await sess('Runtime.enable')

const ev = async (expr) => {
  const r = await sess('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const clickAt = async (x, y) => {
  await sess('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await sess('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sess('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const shot = async (name, clip) => {
  const s = await sess('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'))
  log('  截图 →', name)
}

/** 打开设置 → B站背景 */
async function openBiliPanel() {
  await ev(`(() => {
    const b = [...document.querySelectorAll('button')].filter(e => {
      const r = e.getBoundingClientRect(); const t = (e.innerText || '').trim();
      return r.width > 0 && r.y > innerHeight - 200 && t.length > 0 && t.length < 20;
    })[0];
    if (!b) throw new Error('找不到用户头像按钮');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`).then((p) => clickAt(p.x, p.y))
  await sleep(2200)

  const setPos = await ev(`(() => {
    const b = [...document.querySelectorAll('button,[role="menuitem"]')]
      .find(e => /^设置/.test((e.innerText || '').trim()));
    if (!b) throw new Error('菜单里没有设置');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`)
  await clickAt(setPos.x, setPos.y)
  await sleep(3500)

  const navPos = await ev(`(() => {
    const c = [...document.querySelectorAll('button,[role="tab"],a,div,span,li')].filter(e => {
      const t = (e.innerText || '').trim(); const r = e.getBoundingClientRect();
      return t === 'B站背景' && r.width > 0 && r.height > 0;
    });
    if (!c.length) throw new Error('设置里没有 B站背景');
    const r = c[0].getBoundingClientRect();
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
  })()`)
  await clickAt(navPos.x, navPos.y)
  await sleep(6000)
}

/**
 * 截图前遮掉个人身份信息。
 *
 * 截图会发布到 README、npm 与 GitHub Release，里面绝不能出现使用者的
 * 账号名（左下角那个用户按钮）和头像。这里在页面上把它们替换成占位内容，
 * 而不是事后拿图片工具在像素上涂 —— 后者换个分辨率就会漏。
 */
const redactIdentity = async () => {
  const replaced = await ev(`(() => {
    let n = 0;
    /* 1) 左下角用户按钮：文字换成 "User"，头像换成纯色块 */
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      const t = (b.innerText || '').trim();
      if (r.width > 0 && r.y > innerHeight - 220 && t.length > 0 && t.length < 20) {
        b.textContent = 'User';
        n++;
        for (const img of b.querySelectorAll('img')) { img.style.visibility = 'hidden'; }
        for (const el of b.querySelectorAll('div,span')) {
          const cs = getComputedStyle(el);
          if (cs.borderRadius && parseFloat(cs.borderRadius) >= 8) el.style.visibility = 'hidden';
        }
      }
    }
    /* 2) 设置面板里的账号行（"已登录 · xxx"）—— 只保留"已登录" */
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const tn = walker.currentNode;
      if (/已登录\s*·\s*\S+/.test(tn.nodeValue)) {
        tn.nodeValue = tn.nodeValue.replace(/已登录\s*·\s*\S+/g, '已登录');
        n++;
      }
      if (/Logged in\s*·\s*\S+/i.test(tn.nodeValue)) {
        tn.nodeValue = tn.nodeValue.replace(/Logged in\s*·\s*\S+/gi, 'Logged in');
        n++;
      }
    }
    return n;
  })()`)
  log('已遮蔽身份信息处:', replaced)
  await sleep(600)
}

/* ① 背景效果：不打开设置，直接截整个界面 */
await sess('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
await sess('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(13000)

const state = await ev(`(() => {
  const v = document.querySelector('#bw-layer video'); const l = document.querySelector('#bw-layer');
  return { layer: !!l, on: l?.dataset?.on ?? null, video: !!v, t: v?.currentTime ?? null, paused: v?.paused ?? null };
})()`)
log('背景层:', JSON.stringify(state))
if (state?.video) {
  await sleep(4000)
  const t2 = await ev(`document.querySelector('#bw-layer video')?.currentTime`)
  log('4 秒后 currentTime:', t2, '（比之前大说明在实时播放）')
}
await redactIdentity()
await shot('real-background.png')

/* ② 设置面板：换成更高视口，进面板后裁到内容区 */
await sess('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1240, deviceScaleFactor: 2, mobile: false })
await sess('Page.navigate', { url: `${BASE}/?token=${TOKEN}` })
await sleep(10000)
await openBiliPanel()
await redactIdentity()

const bounds = await ev(`(() => {
  const root = document.querySelector('[data-bw-page]');
  if (!root) throw new Error('找不到设置面板 root');
  const r = root.getBoundingClientRect();
  let maxRight = r.right;
  for (const e of root.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width > 0 && b.right > maxRight) maxRight = b.right;
  }
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(maxRight - r.left), h: Math.round(r.height) };
})()`)
log('面板内容区:', JSON.stringify(bounds))

const pad = 18
const clip = {
  x: Math.max(0, bounds.x - pad),
  y: Math.max(0, bounds.y - pad),
  width: Math.min(1440 - Math.max(0, bounds.x - pad), bounds.w + pad * 2),
  height: Math.min(1240 - Math.max(0, bounds.y - pad), bounds.h + pad * 2),
  scale: 2,
}
log('裁切:', JSON.stringify(clip), '装得下:', clip.height >= bounds.h + pad)
await shot('real-settings.png', clip)

edge.kill()
await sleep(300)
process.exit(0)