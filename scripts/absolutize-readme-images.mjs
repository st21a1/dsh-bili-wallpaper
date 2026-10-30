// 把 README 里的相对图片路径换成 GitHub raw 绝对地址：
// GitHub 和 npm 两边都能正常显示，也不必把截图塞进 tarball。
import { readFileSync, writeFileSync } from 'node:fs'

const RAW = 'https://raw.githubusercontent.com/st21a1/dsh-bili-wallpaper/main'
const file = new URL('../README.md', import.meta.url)

let md = readFileSync(file, 'utf8')
const before = md
md = md.replace(/src="assets\//g, 'src="' + RAW + '/assets/')
md = md.replace(/\]\(assets\//g, '](' + RAW + '/assets/')
writeFileSync(file, md, 'utf8')

const remainingRel = (md.match(/src="assets\//g) || []).length
console.log('README 图片绝对化:', md !== before ? '已修改' : '无需修改')
console.log('剩余相对引用:', remainingRel)
console.log('绝对图片数:', (md.match(/raw\.githubusercontent\.com/g) || []).length)