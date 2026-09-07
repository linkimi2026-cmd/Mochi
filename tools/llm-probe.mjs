#!/usr/bin/env node
/**
 * Mochi LLM 观测代理。
 *
 * 为什么需要它：dsh 把「模型看到什么」完全藏在 SSE 流里，出问题时只能靠猜。
 * 这个代理夹在 dsh 和智谱之间，把每一次 chat 请求的完整载荷（含 tools 数组、
 * system prompt、tools 选择）原样落盘，再原样转发并把响应流式回传。
 *
 * 用法：
 *   1. 启动：node tools/llm-probe.mjs
 *   2. settings.yaml 里把 llm-deepseek.baseURL 改成 http://127.0.0.1:8787/api/paas/v4
 *   3. 跑 dsh，然后看 probe-log/<序号>-request.json
 *
 * 注意：本机 curl/浏览器走代理，但这个转发用 node fetch 直连，
 * 且 dsh → 127.0.0.1 是回环地址，不需要 --noproxy。
 */

import { createServer } from 'node:http'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = Number(process.env.PROBE_PORT ?? 8787)
// 上游默认智谱官方；接其他 OpenAI 兼容端点时用 PROBE_UPSTREAM 覆盖
// （例：PROBE_UPSTREAM=https://mimo.ezlook.top —— 只写 origin，不带 /v1）。
const UPSTREAM = process.env.PROBE_UPSTREAM ?? 'https://open.bigmodel.cn'
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'probe-log.nosync')

await mkdir(LOG_DIR, { recursive: true })

let seq = 0
try {
  seq = (await readdir(LOG_DIR)).filter((f) => f.endsWith('-request.json')).length
} catch { /* 目录刚建，从 0 开始 */ }

const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const body = Buffer.concat(chunks)
    const id = String(seq++).padStart(3, '0')

    // ── 落盘：完整请求 + 一份人类可读摘要 ──
    let parsed = null
    try { parsed = JSON.parse(body.toString('utf8')) } catch { /* 非 JSON，原样存 */ }
    await writeFile(join(LOG_DIR, `${id}-request.json`), body)

    const summary = {
      id,
      model: parsed?.model,
      messageCount: parsed?.messages?.length ?? 0,
      toolNames: (parsed?.tools ?? []).map((t) => t?.function?.name ?? t?.name),
      toolCount: parsed?.tools?.length ?? 0,
      hasToolChoice: 'tool_choice' in (parsed ?? {}),
      topLevelKeys: Object.keys(parsed ?? {}),
      // 完整请求头落盘（小写键），用于排查网关对特定客户端头的兼容性问题
      requestHeaders: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length'].includes(k))),
      systemChars: (parsed?.messages ?? [])
        .filter((m) => m.role === 'system')
        .reduce((n, m) => n + String(m.content ?? '').length, 0),
      lastUser: (parsed?.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content,
    }
    await writeFile(join(LOG_DIR, `${id}-summary.json`), JSON.stringify(summary, null, 2))
    console.log(`[probe #${id}] tools=${summary.toolCount} → ${summary.toolNames.join(', ') || '(无)'}`)

    // ── 转发 ──
    try {
      const headers = { 'content-type': 'application/json' }
      if (req.headers.authorization) headers.authorization = req.headers.authorization
      const upstream = await fetch(`${UPSTREAM}${req.url}`, {
        method: req.method,
        headers,
        body,
      })
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-cache',
      })
      // 流式回传（SSE）
      for await (const chunk of upstream.body) res.write(chunk)
      res.end()
    } catch (error) {
      console.error(`[probe #${id}] 转发失败:`, error.message)
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `probe upstream failed: ${error.message}` } }))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mochi LLM 观测代理已启动: http://127.0.0.1:${PORT}`)
  console.log(`请求落盘目录: ${LOG_DIR}`)
})
