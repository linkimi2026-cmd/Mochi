#!/usr/bin/env node
/**
 * 提示词前缀缓存（prompt prefix cache）命中率实测。
 *
 * 为什么需要它：Mochi 每一轮请求都要重发同一段前缀——persona + 全部工具
 * schema + 历史消息。网关不做前缀缓存的话，每一轮都按全量 prompt 计费，
 * 长会话成本线性爆炸。所以「缓存命中率」不是性能指标，是**成本与可用性指标**。
 *
 * 观测口径（与 dsh 产物一致，见 llm-deepseek/lib/index.js 的 usage 映射）：
 *   cacheRead = usage.prompt_tokens_details.cached_tokens ?? usage.prompt_cache_hit_tokens
 *   hitRate   = cacheRead / prompt_tokens        ← prompt_tokens 含命中部分
 * 请求体也照 dsh 产物打：stream:true + stream_options:{include_usage:true}。
 * 少了 include_usage，网关就不会在流尾回传 usage，命中率直接不可观测。
 *
 * 前缀来源（默认就是「我们现在真正要发的东西」）：
 *   persona  ← apps/desktop/resources/mochi-web/patches/core.patch.yml（当前发布的系统提示词）
 *   tools     ← 最近一次真实 dsh 抓包里的 tools 数组（probe-log.nosync/*-request.json）
 * 两者都可用 --persona-file / --tools-file 覆盖。
 *
 * 用法：
 *   node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash --repeat 3
 *   node tools/cache-hit-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash --turns 5
 *   node tools/cache-hit-probe.mjs --provider mochi-mimo --model mimo-v2.5 --repeat 3
 *
 * 红线：密钥只从 secrets/packaging-keys.local.yaml 读，只打掩码，绝不入日志。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CREDENTIALS = join(ROOT, 'secrets', 'packaging-keys.local.yaml')
const DEFAULT_PERSONA = join(ROOT, 'apps/desktop/resources/mochi-web/patches/core.patch.yml')
const PROBE_LOG = join(ROOT, 'probe-log.nosync')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

const providerName = flag('provider', 'mochi-aiaaa')
const model = flag('model', null)
const repeat = Number(flag('repeat', 0))
const switchAt = Number(flag('switch-at', 0))
// 网关的前缀缓存是**服务端持久**的：同一个前缀几分钟前跑过，这次就是热的。
// 于是"换面会不会掉缓存"这类实验会被上一次运行污染，得出完全相反的结论
// （实测：没加 nonce 时换面那一轮命中 99.44%，看着像"换面不要钱"）。
// 加一个随机标记打在 persona **最前面**，整段前缀立刻变冷，实验才干净。
const nonce = argv.includes('--nonce') ? `[run-${Math.random().toString(36).slice(2, 10)}]\n` : ''
const turns = Number(flag('turns', 0))
const personaFile = resolve(ROOT, flag('persona-file', DEFAULT_PERSONA))
const toolsFile = flag('tools-file', null)

// ── 凭据 ──────────────────────────────────────────────────────────────────
function loadCredentials(text) {
  const providers = {}
  const refs = {}
  let section = null
  let current = null
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue
    const indent = raw.match(/^\s*/)[0].length
    const line = raw.trim()
    if (indent === 0) { const m = line.match(/^([A-Za-z0-9_]+):\s*$/); section = m ? m[1] : null; current = null; continue }
    if (indent === 2 && line.endsWith(':')) { current = line.slice(0, -1).trim(); if (section === 'providers') providers[current] = {}; continue }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const clean = kv[2].replace(/^["']|["']$/g, '')
    if (section === 'providers' && current) providers[current][kv[1]] = clean
    else if (section === 'credentialsRefs') refs[kv[1]] = clean
  }
  return { providers, refs }
}

/** 从 YAML 块标量里抠出 system-prompt 的 persona（只认 `persona: >-` + 更深缩进）。 */
function readPersona(path) {
  const lines = readFileSync(path, 'utf8').split('\n')
  const start = lines.findIndex((line) => /^\s*persona:\s*>-\s*$/.test(line))
  if (start === -1) throw new Error(`${path} 里找不到 'persona: >-'`)
  const indent = lines[start].match(/^\s*/)[0].length
  const body = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().length === 0) { body.push(''); continue }
    if (line.match(/^\s*/)[0].length <= indent) break
    body.push(line.slice(indent + 2))
  }
  return body.join('\n').trim()
}

/** 取最近一次真实抓包里的 tools 数组（按文件名倒序找第一个带 tools 的）。 */
function readTools(explicit) {
  let tools
  let source
  if (explicit) {
    const captured = JSON.parse(readFileSync(resolve(ROOT, explicit), 'utf8'))
    tools = captured.tools ?? []
    source = explicit
  } else {
    const files = readdirSync(PROBE_LOG).filter((f) => f.endsWith('-request.json')).sort().reverse()
    for (const file of files) {
      try {
        const captured = JSON.parse(readFileSync(join(PROBE_LOG, file), 'utf8'))
        if (Array.isArray(captured.tools) && captured.tools.length > 0) {
          tools = captured.tools
          source = `probe-log.nosync/${file}`
          break
        }
      } catch { /* 跳过坏抓包 */ }
    }
    if (!tools) throw new Error(`${PROBE_LOG} 里没有带 tools 的抓包`)
  }

  // ── 2026-09-12 P0 的独立复核 ────────────────────────────────────────────
  // 模型可见的工具名只能是 [a-zA-Z0-9_-]。点号会让网关整轮 400：
  //   Invalid 'tools[N].***.name': string does not match pattern
  //   '^[a-zA-Z0-9_-]+$'
  // 抓包早于该修复，里面还留着 jxl.* 这种旧名。这里**主动剔除**并点名，
  // 而不是把它发出去再看 400 —— 否则每次都会误判成"网关不支持缓存"。
  const LEGAL_NAME = /^[a-zA-Z0-9_-]+$/
  const dropped = tools.filter((tool) => !LEGAL_NAME.test(String(tool?.function?.name ?? ''))).map((tool) => tool?.function?.name ?? '(无名)')
  const legal = tools.filter((tool) => LEGAL_NAME.test(String(tool?.function?.name ?? '')))
  return { tools: legal, source, dropped, droppedFrom: tools.length }
}

const { providers, refs } = loadCredentials(readFileSync(CREDENTIALS, 'utf8'))
const provider = providers[providerName]
if (!provider) { console.error(`未知 provider "${providerName}"；可用：${Object.keys(providers).join(', ')}`); process.exit(1) }
const apiKey = refs[provider.apiKeyEnv]
if (!apiKey) { console.error(`缺少密钥 ${provider.apiKeyEnv}`); process.exit(1) }
const endpoint = `${provider.baseURL.replace(/\/$/, '')}/chat/completions`
const activeModel = model ?? provider.defaultModel
const mask = (v) => `${v.slice(0, 7)}…${v.slice(-4)}`

const persona = nonce + readPersona(personaFile)
const { tools, source: toolsSource, dropped, droppedFrom } = readTools(toolsFile)

console.log(`provider   ${providerName}  (${mask(apiKey)})`)
console.log(`endpoint   ${endpoint}`)
console.log(`model      ${activeModel}`)
console.log(`persona    ${persona.length} 字符  ← ${personaFile.replace(`${ROOT}/`, '')}`)
console.log(`tools      ${tools.length} 个 schema，${JSON.stringify(tools).length} 字符  ← ${toolsSource}`)
if (dropped.length > 0) {
  console.log(`           ⚠ 剔除 ${dropped.length}/${droppedFrom} 个非法工具名（含点号，会让网关整轮 400）：`)
  console.log(`             ${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ` …（共 ${dropped.length} 个）` : ''}`)
}
console.log('')

// ── 单次请求 ──────────────────────────────────────────────────────────────
async function send(messages, toolSet = tools) {
  const started = Date.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: activeModel,
      messages,
      tools: toolSet,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 256,
    }),
  })
  const raw = await response.text()
  const elapsed = Date.now() - started

  let usage = null
  let dataLines = 0
  let content = ''
  let errorLine = null
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    dataLines++
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    let chunk = null
    try { chunk = JSON.parse(payload) } catch { continue }
    if (chunk.error) { errorLine = `HTTP ${response.status} ${JSON.stringify(chunk.error).slice(0, 300)}`; continue }
    if (chunk.usage) usage = chunk.usage
    const delta = chunk.choices?.[0]?.delta ?? {}
    if (delta.content) content += delta.content
  }
  // ── 最容易自欺的地方 ────────────────────────────────────────────────────
  // 网关把 400 以 HTTP 200 + JSON 单行错误体返回时（Mochi 踩过，技能坑 31），
  // 一个 `data:` 都没有。只看 usage 是不是 null，就会把「请求被拒绝」误判成
  // 「成功但没带 usage」——结论会正好反过来。
  if (dataLines === 0) {
    return { error: `HTTP ${response.status} 非 SSE 响应，无 data: 行 → ${raw.trim().slice(0, 300) || '(空响应体)'}`, elapsed }
  }
  if (errorLine && usage === null) return { error: errorLine, elapsed }
  return { usage, text: content, dataLines, elapsed }
}

function normalize(usage) {
  if (!usage) return null
  const promptTokens = usage.prompt_tokens ?? 0
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? null
  const cacheMiss = usage.prompt_cache_miss_tokens ?? (cacheRead === null ? null : promptTokens - cacheRead)
  return {
    promptTokens,
    cacheRead,
    cacheMiss,
    completionTokens: usage.completion_tokens ?? 0,
    hitRate: cacheRead === null || promptTokens === 0 ? null : cacheRead / promptTokens,
    raw: usage,
  }
}

const pct = (value) => (value === null ? '  n/a' : `${(value * 100).toFixed(2)}%`.padStart(7))
const num = (value) => (value === null ? 'n/a' : String(value).padStart(7))

const rows = []
function record(label, result) {
  if (result.error) { console.log(`${label.padEnd(10)} ✗ ${result.error}`); return false }
  const normalized = normalize(result.usage)
  if (!normalized) {
    console.log(`${label.padEnd(10)} usage 缺失（网关忽略了 stream_options.include_usage）  ${result.elapsed}ms  data行=${result.dataLines}`)
    return true
  }
  console.log(`${label.padEnd(10)} prompt=${num(normalized.promptTokens)}  命中=${num(normalized.cacheRead)}`
    + `  未命中=${num(normalized.cacheMiss)}  cacheReadTokens=${pct(normalized.hitRate)}  ${result.elapsed}ms`)
  rows.push(normalized)
  return true
}

// ── 模式 C：会话中途换工具面（模拟「对话界面 → 工作界面」切换）─────────────
if (switchAt > 0) {
  const narrow = tools.slice(0, Math.max(1, tools.length - 20))
  const wide = tools
  console.log(`模式 C：前 ${switchAt} 轮用窄工具面（${narrow.length} 个），第 ${switchAt + 1} 轮起换成宽工具面（${wide.length} 个）`)
  console.log('  这正是老师从「对话界面」切到「工作界面」时发生的事：工具面被 restrict 收窄的那一份换成全量。')
  console.log('')
  const messages = [{ role: 'system', content: persona }]
  const USER_TURNS = [
    '现在有哪些学生在医务室？简短回答。',
    '有超时没回班的吗？',
    '整理成一句话。',
    '再说一遍结论。',
    '还有别的要注意的吗？',
    '确认你上一条说了什么。',
  ]
  const total = switchAt + 3
  for (let turn = 0; turn < total; turn++) {
    const activeTools = turn < switchAt ? narrow : wide
    messages.push({ role: 'user', content: USER_TURNS[turn % USER_TURNS.length] })
    const result = await send(messages, activeTools)
    const label = turn === switchAt ? `轮${turn + 1}换面` : `轮${turn + 1}`
    if (!record(label, result)) process.exit(2)
    messages.push({ role: 'assistant', content: result.text || '(空)' })
  }
} else if (repeat > 0) {
  const messages = [
    { role: 'system', content: persona },
    { role: 'user', content: '现在有哪些学生在医务室？简短回答，不要展开。' },
  ]
  console.log(`模式 A：同一请求连发 ${repeat} 遍（第 1 遍建立缓存，其后为纯前缀命中）\n`)
  for (let i = 1; i <= repeat; i++) {
    const result = await send(messages)
    if (!record(`第${i}遍`, result)) process.exit(2)
    if (i === 1 && result.usage) console.log(`           usage 原始键: ${Object.keys(result.usage).join(', ')}`)
  }
} else if (turns > 0) {
  // ── 模式 B：递进多轮 ────────────────────────────────────────────────────
  const USER_TURNS = [
    '今天有哪些学生还在医务室？简短回答。',
    '如果有超时没回班的，帮我点出来。',
    '把结果整理成一句话给我。',
    '再说一遍刚才的结论。',
    '还有别的需要注意的吗？简短说。',
    '确认一下你上一条说的是什么。',
  ]
  const messages = [{ role: 'system', content: persona }]
  console.log(`模式 B：递进 ${turns} 轮（前缀每轮增长，看命中率怎么走）\n`)
  for (let turn = 0; turn < turns; turn++) {
    messages.push({ role: 'user', content: USER_TURNS[turn % USER_TURNS.length] })
    const result = await send(messages)
    if (!record(`轮${turn + 1}`, result)) process.exit(2)
    messages.push({ role: 'assistant', content: result.text || '(空)' })
  }
} else {
  console.error('给一个模式：--repeat N（同一请求连发）或 --turns N（递进多轮）')
  process.exit(1)
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
const measured = rows.filter((r) => r.hitRate !== null)
if (measured.length === 0) {
  console.log('\n结论：网关没有回传缓存字段 —— 命中率无法从 usage 观测。')
  process.exit(3)
}
const sum = (list, key) => list.reduce((n, r) => n + (r[key] ?? 0), 0)
const allHit = sum(measured, 'cacheRead')
const allPrompt = sum(measured, 'promptTokens')
console.log(`\n累计：命中 ${allHit} / prompt ${allPrompt} = ${((allHit / allPrompt) * 100).toFixed(2)}%`)
const steady = measured.slice(1)
if (steady.length > 0) {
  const steadyHit = sum(steady, 'cacheRead')
  const steadyPrompt = sum(steady, 'promptTokens')
  console.log(`首轮之后（稳态）：命中 ${steadyHit} / prompt ${steadyPrompt} = ${((steadyHit / steadyPrompt) * 100).toFixed(2)}%`)
}
