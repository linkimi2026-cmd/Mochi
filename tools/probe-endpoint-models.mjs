#!/usr/bin/env node
/**
 * 端点模型清单探测。
 *
 * 为什么需要它：`runtime-profile.json` 里声明的模型名是**我们写的**，
 * 但网关实际提供什么是**网关决定的**。两者不一致时，模型调用会 404，
 * 而且报错发生在 SSE 流中间，看起来像"模型不听话"。
 * 所以换模型/加模型之前，先问端点要一份真实清单。
 *
 * 用法：
 *   node tools/probe-endpoint-models.mjs            # 全部 provider
 *   node tools/probe-endpoint-models.mjs aiaaa      # 只探某个 provider（名字模糊匹配）
 *   node tools/probe-endpoint-models.mjs --filter v4
 *
 * 密钥来源：secrets/packaging-keys.local.yaml（本地专用，永不入 git）。
 * 绝不把 key 打到 stdout —— 只输出前后各 4 位。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CREDENTIALS = join(ROOT, 'secrets', 'packaging-keys.local.yaml')

const args = process.argv.slice(2)
const filterIndex = args.indexOf('--filter')
const nameFilter = args.filter((a) => !a.startsWith('--') && a !== args[filterIndex + 1])
const modelFilter = filterIndex >= 0 ? args[filterIndex + 1] : null

// ── 极简 YAML 读取：只支持本文件实际用到的两层结构，不引依赖 ──
function loadCredentials(text) {
  const providers = {}
  const refs = {}
  let section = null
  let current = null
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue
    const indent = raw.match(/^\s*/)[0].length
    const line = raw.trim()
    if (indent === 0) {
      const m = line.match(/^([A-Za-z0-9_]+):\s*$/)
      section = m ? m[1] : null
      current = null
      continue
    }
    if (indent === 2 && line.endsWith(':')) {
      current = line.slice(0, -1).trim()
      if (section === 'providers') providers[current] = {}
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    const clean = value.replace(/^["']|["']$/g, '')
    if (section === 'providers' && current) providers[current][key] = clean
    else if (section === 'credentialsRefs') refs[key] = clean
  }
  return { providers, refs }
}

const mask = (value) => (value && value.length > 10 ? `${value.slice(0, 7)}…${value.slice(-4)}` : '<missing>')

const { providers, refs } = loadCredentials(readFileSync(CREDENTIALS, 'utf8'))

let entries = Object.entries(providers)
if (nameFilter.length > 0) {
  entries = entries.filter(([name]) => nameFilter.some((f) => name.includes(f)))
}
if (entries.length === 0) {
  console.error(`没有匹配的 provider。可用：${Object.keys(providers).join(', ')}`)
  process.exit(1)
}

let failures = 0
for (const [name, config] of entries) {
  const key = refs[config.apiKeyEnv]
  const url = `${config.baseURL.replace(/\/$/, '')}/models`
  console.log(`\n=== ${name} ===`)
  console.log(`  baseURL     ${config.baseURL}`)
  console.log(`  apiKeyEnv   ${config.apiKeyEnv}  (${mask(key)})`)
  console.log(`  defaultModel ${config.defaultModel ?? '(未声明)'}`)
  if (!key) { console.log('  ✗ 密钥缺失，跳过'); failures++; continue }

  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${key}` } })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    if (!response.ok) {
      console.log(`  ✗ HTTP ${response.status} ${text.slice(0, 200)}`)
      failures++
      continue
    }
    const ids = (json?.data ?? json?.models ?? []).map((m) => m.id ?? m.name ?? String(m)).sort()
    console.log(`  ✓ HTTP ${response.status}，共 ${ids.length} 个模型`)
    const shown = modelFilter ? ids.filter((id) => id.includes(modelFilter)) : ids
    for (const id of shown) {
      const declared = id === config.defaultModel ? '  ← defaultModel' : ''
      console.log(`      ${id}${declared}`)
    }
    if (modelFilter && shown.length === 0) console.log(`      (没有含 "${modelFilter}" 的模型)`)
  } catch (error) {
    console.log(`  ✗ 连接失败: ${error.message}`)
    failures++
  }
}

console.log('')
process.exit(failures > 0 ? 2 : 0)
