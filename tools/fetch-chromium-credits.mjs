#!/usr/bin/env node
/**
 * 导出 Chromium 的 `chrome://credits`（第三方许可清单）。
 *
 * 为什么不用 `--dump-dom chrome://credits`：
 * 实测 Chromium 140 在 macOS 上会**忽略这个 URL，转而 dump 新标签页**
 * （26 KB、标题「新标签页」、`Copyright` 零命中）。
 * 危险的是 CI 的校验只断言输出里含 `<html` —— 新标签页同样含 `<html`，
 * 所以**这条校验抓不住"导错了页"**。这里改走 CDP：
 * 起一个带 `--remote-debugging-port` 的实例，用 `Page.navigate` 到
 * `chrome://credits`（CDP 不受命令行 URL 限制），再 `Runtime.evaluate`
 * 取 `documentElement.outerHTML`。取到的必须是**真的** credits：
 * 少于阈值或缺关键指纹就直接失败，绝不产出占位内容。
 *
 * 用法：node tools/fetch-chromium-credits.mjs --chrome <可执行文件> --out <目录>
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

const chromePath = resolve(flag('chrome') ?? '')
const outDir = resolve(flag('out') ?? '.')
const port = Number(flag('port', 9333))
if (!flag('chrome')) { console.error('需要 --chrome <Chromium 可执行文件>'); process.exit(1) }

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * 总看门狗。踩过的坑：Chromium 因为环境限制**起得来但连不上 CDP**，
 * 而 `socket.onopen` 既不会触发也不会 error —— 没有超时就会永久挂住，
 * 看起来像"还在跑"，实际永远不返回。任何一步都必须有上界。
 */
const WATCHDOG_MS = Number(flag('watchdog', 120)) * 1000
const watchdog = setTimeout(() => {
  console.error(`✗ ${WATCHDOG_MS / 1000}s 内没拿到 credits，主动退出（可能是 Chromium 起得来但 CDP 连不上）。`)
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  process.exit(4)
}, WATCHDOG_MS)

const child = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(outDir, '.credits-profile')}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] })

let closed = false
const finish = (code) => {
  if (closed) return
  closed = true
  try { child.kill('SIGKILL') } catch { /* 已退出 */ }
  process.exit(code)
}

async function cdpTarget() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((entry) => entry.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  throw new Error('等不到 CDP 端点')
}

const url = await cdpTarget()

// 极简 CDP 客户端：只需要 send + 等对应 id 的回包。
const socket = new WebSocket(url)
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error('CDP WebSocket 在 15s 内没有打开')), 15_000)
  socket.onopen = () => { clearTimeout(timer); done() }
  socket.onerror = () => { clearTimeout(timer); fail(new Error('CDP WebSocket 连接失败')) }
})

let nextId = 1
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve: done } = pending.get(message.id)
    pending.delete(message.id)
    done(message)
  }
}
const send = (method, params = {}) => new Promise((done) => {
  const id = nextId++
  const timer = setTimeout(() => {
    pending.delete(id)
    done({ errorText: `CDP ${method} 在 20s 内没有回包` })
  }, 20_000)
  pending.set(id, { resolve: (message) => { clearTimeout(timer); done(message) } })
  socket.send(JSON.stringify({ id, method, params }))
})

await send('Page.enable')
const navigation = await send('Page.navigate', { url: 'chrome://credits' })
if (navigation.errorText) { console.error(`导航失败：${navigation.errorText}`); finish(2) }

// credits 页很大且懒渲染，给足时间再取。
await sleep(8000)
const evaluated = await send('Runtime.evaluate', {
  expression: 'document.documentElement ? document.documentElement.outerHTML : ""',
  returnByValue: true,
})
const html = evaluated.result?.result?.value ?? ''

const copyrightHits = (html.match(/Copyright/gi) ?? []).length
const licenseHits = (html.match(/LICENSE|License/g) ?? []).length

console.log(`取出 ${html.length} 字符；Copyright 命中 ${copyrightHits}；License 命中 ${licenseHits}`)
console.log(`标题：${(html.match(/<title[^>]*>([^<]*)<\/title>/i) ?? [])[1] ?? '(无)'}`)

// ── 必须是**真的** credits，不是新标签页 ──────────────────────────────────
if (html.length < 200000 || copyrightHits < 100) {
  console.error('')
  console.error('✗ 取到的不是 chrome://credits（体量或指纹不达标）。')
  console.error('  常见症状：拿到的是新标签页（约 26 KB、标题「新标签页」、无 Copyright）。')
  console.error('  本脚本**拒绝**写出占位内容 —— 许可清单造假比缺文件更糟。')
  finish(3)
}

const creditsText = html
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'credits.html'), html)
writeFileSync(join(outDir, 'credits.txt'), creditsText)
console.log(`已写出 ${join(outDir, 'credits.html')}（${html.length} B）`)
console.log(`已写出 ${join(outDir, 'credits.txt')}（${creditsText.length} B）`)
finish(0)
