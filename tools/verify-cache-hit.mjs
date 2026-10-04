#!/usr/bin/env node
/**
 * 缓存命中率验收（从会话日志读真实 usage，不看网关面板也不靠猜）。
 *
 * 口径：dsh 的适配器把 usage 映射成 **互斥** 的两个数字
 * （llm-deepseek/src/translate.ts 的注释：DeepSeek 的 prompt_tokens 含命中，
 *  映射时把命中数从 inputTokens 里减掉）：
 *     inputTokens     = prompt_tokens - cacheReadTokens   未命中的那部分
 *     cacheReadTokens = 命中前缀的那部分
 *   所以「本轮 prompt 总量」= inputTokens + cacheReadTokens，
 *   命中率 = cacheReadTokens / (inputTokens + cacheReadTokens)。
 *
 * 为什么单独做成脚本：命中率只有**多轮**才有意义。第一轮必然 0%（缓存要建），
 * 单看某一轮不是结论。要看的是「前缀稳定之后」的稳态值。
 *
 * 用法：
 *   node tools/verify-cache-hit.mjs                       # 最新一个会话
 *   node tools/verify-cache-hit.mjs --home /tmp/x         # 指定 DSH_HOME
 *   node tools/verify-cache-hit.mjs --session <id>        # 指定会话
 *   node tools/verify-cache-hit.mjs --threshold 0.99      # 低于阈值以退出码 1 阻断
 *
 * 退出码：0 = 达标；1 = 低于阈值；2 = 找不到会话 / 读不出用量 / 稳态无可用计数 / 缺少 zstd CLI。
 */

import { readdirSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}
const home = resolve(flag('home', join(ROOT, '.mochi-home.nosync')))
const sessionFilter = flag('session', null)
const threshold = Number(flag('threshold', 0))

// ── 找会话 ────────────────────────────────────────────────────────────────
const sessionsRoot = join(home, 'sessions')
if (!existsSync(sessionsRoot)) { console.error(`没有会话目录：${sessionsRoot}`); process.exit(2) }

const found = []
for (const workspace of readdirSync(sessionsRoot)) {
  const workspacePath = join(sessionsRoot, workspace)
  if (!statSync(workspacePath).isDirectory()) continue
  for (const session of readdirSync(workspacePath)) {
    const sessionPath = join(workspacePath, session)
    if (!statSync(sessionPath).isDirectory()) continue
    // 一个会话目录里可能同时躺着 v1 与 v2 两份日志（session.jsonl.zstd /
    // session.v2.jsonl.zstd）。v1 是旧格式镜像，用量字段位置不同——按 mtime
    // 取"最新文件"会随机挑到 v1，然后报"没有用量记录"。**必须显式优先 v2**。
    const candidates = readdirSync(sessionPath).filter((file) => file.startsWith('session') && file.endsWith('.zstd'))
    const chosen = candidates.find((file) => file.includes('.v2.')) ?? candidates.find((file) => !file.includes('.v2.'))
    if (!chosen) continue
    const path = join(sessionPath, chosen)
    found.push({ session, file: chosen, path, mtime: statSync(path).mtimeMs })
  }
}
if (found.length === 0) { console.error(`没有会话日志：${sessionsRoot}`); process.exit(2) }
found.sort((a, b) => b.mtime - a.mtime)

const target = sessionFilter
  ? found.find((entry) => entry.session.includes(sessionFilter))
  : found[0]
if (!target) { console.error(`找不到匹配的会话：${sessionFilter}`); process.exit(2) }

// ── 解压 ──────────────────────────────────────────────────────────────────
// 会话日志是**多帧 zstd**：进程每落一批就往同一个文件追加一个独立帧。
// Node 的 zstdDecompressSync 只读第一帧；第一帧恰好以换行结尾时，无法用文本
// 完整性启发式发现截断，甚至会得到看似可信的高命中率。因此只接受 zstd CLI
// 的完整流解码；缺少 CLI 时拒绝计算。
function decompress(path) {
  try {
    return { text: execFileSync('zstd', ['-dc', path], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8'), via: 'zstd -dc' }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  console.error('本机没有 zstd 命令。Node 自带解压不能保证读取会话日志的全部 zstd 帧。')
  console.error('拒绝用可能不完整的数据算命中率 —— 请先安装 zstd（brew install zstd），再重试。')
  process.exit(2)
}

const { text, via } = decompress(target.path)
const events = text.trim().split('\n').map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)

const header = events.find((event) => event.type === 'request/header')
const config = header?.data?.header?.config ?? {}
const usages = events.filter((event) => event.type === 'assistant/message' && event.data?.usage)

console.log(`会话      ${target.session}`)
console.log(`日志      ${target.file}  ${target.path.replace(`${ROOT}/`, '')}  （解压：${via}）`)
console.log(`模型      ${config.provider ?? '?'} / ${config.model ?? '?'}${config.reasoningEffort ? `  reasoningEffort=${config.reasoningEffort}` : ''}`)
console.log(`请求数    ${usages.length}（= 本会话发起的模型请求数）`)
console.log('')

if (usages.length === 0) { console.error('这个会话没有任何 assistant/message 用量记录'); process.exit(2) }

const rows = usages.map((event, index) => {
  const usage = event.data.usage
  const hasInput = Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
  const input = hasInput ? usage.inputTokens : null
  const hasCacheRead = Number.isSafeInteger(usage.cacheReadTokens) && usage.cacheReadTokens >= 0
  const cacheRead = hasCacheRead ? usage.cacheReadTokens : null
  const hasCounts = hasInput && hasCacheRead && Number.isSafeInteger(input + cacheRead)
  const prompt = hasCounts ? input + cacheRead : null
  return {
    index: index + 1,
    input,
    cacheRead,
    prompt,
    output: usage.outputTokens ?? 0,
    hitRate: !hasCounts || prompt === 0 ? null : cacheRead / prompt,
    hasCounts,
  }
})

console.log('轮次    prompt     命中      未命中    命中率')
for (const row of rows) {
  const rate = row.hitRate === null ? '   n/a' : `${(row.hitRate * 100).toFixed(2)}%`.padStart(7)
  const prompt = row.prompt === null ? 'n/a' : String(row.prompt).padStart(9)
  const cacheRead = row.cacheRead === null ? 'n/a' : String(row.cacheRead).padStart(8)
  const input = row.hasCounts ? String(row.input).padStart(8) : '     n/a'
  const note = row.hitRate === 0 && row.index === 1 ? '   ← 首轮，缓存未建立，0% 是正常的' : ''
  console.log(
    `${String(row.index).padStart(3)}  ${prompt}  ${cacheRead}`
    + `  ${input}  ${rate}${note}`,
  )
}

const sum = (list, key) => list.reduce((n, row) => n + row[key], 0)
const counted = rows.filter((row) => row.hasCounts)
const steadyRows = rows.filter((row) => row.index > 1)
const steadyMissing = steadyRows.some((row) => !row.hasCounts)
const steady = steadyRows.filter((row) => row.hasCounts)
const steadyPrompt = sum(steady, 'prompt')
const steadyHit = sum(steady, 'cacheRead')
const steadyRate = steadyPrompt === 0 ? null : steadyHit / steadyPrompt

console.log('')
const allPrompt = sum(counted, 'prompt')
const allHit = sum(counted, 'cacheRead')
if (allPrompt > 0) {
  console.log(`全程累计（已计数轮次）：命中 ${allHit} / prompt ${allPrompt} = ${((allHit / allPrompt) * 100).toFixed(2)}%`)
}

if (steadyMissing) {
  if (steadyRate !== null) {
    console.log(`稳态已计数子集：命中 ${steadyHit} / prompt ${steadyPrompt} = ${(steadyRate * 100).toFixed(2)}%`)
  }
  console.log('稳态验收：n/a（第 2 轮起存在缺失或无效的 inputTokens / cacheReadTokens，无法判定）')
  process.exit(2)
}
if (steadyRate === null) {
  console.log('稳态没有完整有效的 inputTokens / cacheReadTokens 计数 —— 命中率无从判断（n/a）。')
  process.exit(2)
}
console.log(`稳态（第 2 轮起）：命中 ${steadyHit} / prompt ${steadyPrompt} = ${(steadyRate * 100).toFixed(2)}%`)

if (threshold > 0) {
  if (steadyRate >= threshold) {
    console.log(`\n✓ 稳态命中率 ${(steadyRate * 100).toFixed(2)}% ≥ 阈值 ${(threshold * 100).toFixed(2)}%`)
    process.exit(0)
  }
  console.log(`\n✗ 稳态命中率 ${(steadyRate * 100).toFixed(2)}% < 阈值 ${(threshold * 100).toFixed(2)}%`)
  process.exit(1)
}
