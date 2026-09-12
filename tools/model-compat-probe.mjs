#!/usr/bin/env node
/**
 * 换模型前的体检（model compatibility check）。
 *
 * 为什么需要它：Mochi 对模型的要求不止"能聊天"。dsh 会按配置打上
 * `thinking` / `reasoning_effort`，会带 51 个工具 schema，会在会话里塞图片。
 * 任何一项网关不认，请求就是 400——而且是**整轮**不可用，不是降级。
 * 所以换模型前先跑这个，把六项能力逐个打勾，别等老师在课堂上撞。
 *
 * 体检项：
 *   1. 基础对话
 *   2. 工具调用（dsh 的全部价值建立在这上面）
 *   3. 流式 usage（不报 usage 就看不到缓存命中，成本失控无感知）
 *   4. thinking 参数（dsh 会打 {type:'disabled'} 或 {type:'enabled'}）
 *   5. reasoning_effort 参数
 *   6. 图片输入（base64 data URL，走 OpenAI 标准 image_url）
 *
 * 用法：
 *   node tools/model-compat-probe.mjs --provider mochi-aiaaa --model deepseek-v4.1-flash
 *   node tools/model-compat-probe.mjs --provider mochi-mimo  --model mimo-v2.5
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CREDENTIALS = join(ROOT, 'secrets', 'packaging-keys.local.yaml')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}
const providerName = flag('provider', 'mochi-aiaaa')
const model = flag('model', null)

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

const { providers, refs } = loadCredentials(readFileSync(CREDENTIALS, 'utf8'))
const provider = providers[providerName]
if (!provider) { console.error(`未知 provider "${providerName}"`); process.exit(1) }
const apiKey = refs[provider.apiKeyEnv]
const endpoint = `${provider.baseURL.replace(/\/$/, '')}/chat/completions`
const activeModel = model ?? provider.defaultModel

console.log(`provider  ${providerName}`)
console.log(`model     ${activeModel}`)
console.log('')

async function call(body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: activeModel, ...body }),
  })
  const raw = await response.text()
  const dataLines = raw.split('\n').filter((l) => l.trim().startsWith('data:')).length
  let usage = null
  let content = ''
  let reasoning = ''
  const toolCalls = []
  let toolCallErr = null
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    let chunk = null
    try { chunk = JSON.parse(payload) } catch { continue }
    if (chunk.error) toolCallErr = JSON.stringify(chunk.error)
    if (chunk.usage) usage = chunk.usage
    const delta = chunk.choices?.[0]?.delta ?? {}
    if (typeof delta.content === 'string') content += delta.content
    // 推理型模型把正文之外的思考放进 reasoning_content；只读 content 会误判成"空回复"。
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
    for (const call of delta.tool_calls ?? []) {
      if (call.function?.name) toolCalls.push(call.function.name)
    }
  }
  return { status: response.status, dataLines, usage, content, reasoning, toolCalls, toolCallErr, raw }
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(26)} ${detail}`)
}

// 1. 基础对话
{
  const r = await call({ messages: [{ role: 'user', content: '回答一个字：好' }], stream: true, stream_options: { include_usage: true }, max_tokens: 64 })
  const said = r.content || r.reasoning
  const where = r.content ? 'content' : (r.reasoning ? 'reasoning_content' : '（两个都空）')
  check('基础对话', r.dataLines > 0 && said.length > 0, `HTTP ${r.status}，${where}=${JSON.stringify(said.slice(0, 24))}`)
}

// 2. 工具调用
{
  const r = await call({
    messages: [{ role: 'user', content: '查一下张明远现在在哪。必须用工具，不要自己编。' }],
    tools: [{
      type: 'function',
      function: {
        name: 'campus_query_student',
        description: '查询学生当前流转状态。',
        parameters: { type: 'object', properties: { keyword: { type: 'string' } }, additionalProperties: false },
      },
    }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 128,
  })
  check('工具调用', r.toolCalls.includes('campus_query_student'), r.toolCalls.length > 0 ? `触发 ${r.toolCalls.join(', ')}` : `未触发${r.toolCallErr ? ` (${r.toolCallErr})` : ''}`)
}

// 3. 流式 usage
{
  const r = await call({ messages: [{ role: 'user', content: '嗨' }], stream: true, stream_options: { include_usage: true }, max_tokens: 16 })
  const keys = r.usage ? Object.keys(r.usage) : []
  const cacheSpelled = r.usage ? (r.usage.prompt_tokens_details !== undefined || r.usage.prompt_cache_hit_tokens !== undefined) : false
  check('流式 usage', r.usage !== null, r.usage ? `键: ${keys.join(', ')}${cacheSpelled ? '（含缓存字段）' : '（无缓存字段）'}` : '未回传 usage —— 缓存命中率不可观测')
}

// 4. thinking 参数：不只问"收不收"，还要问"关了之后真的不推理了吗"
{
  const r = await call({ messages: [{ role: 'user', content: '嗨' }], stream: true, stream_options: { include_usage: true }, thinking: { type: 'disabled' }, max_tokens: 64 })
  const detail = r.dataLines === 0
    ? `拒绝 → ${r.raw.trim().slice(0, 160)}`
    : r.reasoning.length > 0
      ? `接受，但关了还在推理（reasoning_content ${r.reasoning.length} 字符）—— 省钱不成立`
      : `接受，且确实不推理`
  check('thinking:{disabled}', r.dataLines > 0, detail)
}

// 5. reasoning_effort
{
  const r = await call({ messages: [{ role: 'user', content: '嗨' }], stream: true, stream_options: { include_usage: true }, reasoning_effort: 'low', max_tokens: 16 })
  check('reasoning_effort:low', r.dataLines > 0, r.dataLines > 0 ? '接受' : `拒绝 → ${r.raw.trim().slice(0, 160)}`)
}

// 6. 图片输入 —— 1x1 红点 PNG
{
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const r = await call({
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这张图里是什么颜色？只答颜色。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
      ],
    }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 32,
  })
  const imageTokens = r.usage?.prompt_tokens_details?.image_tokens
  check('图片输入', r.dataLines > 0, r.dataLines > 0
    ? `接受${imageTokens !== undefined ? `，image_tokens=${imageTokens}` : '，但 usage 未单列 image_tokens'}`
    : `拒绝 → ${r.raw.trim().slice(0, 160)}`)
}

const passed = results.filter((r) => r.ok).length
console.log(`\n体检结果：${passed}/${results.length} 通过`)
