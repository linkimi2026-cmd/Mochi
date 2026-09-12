#!/usr/bin/env node
/**
 * 缓存可观测性守卫（零依赖，可在 CI 硬跑）。
 *
 * 为什么需要它：我们对外承诺「缓存命中率 ≥99%」。这个承诺成立的前提是
 * **网关会把 usage 回传回来**——而 usage 只在请求里带了
 * `stream_options: { include_usage: true }` 时才会在 SSE 流尾出现。
 * 产物里那一行是上游代码；任何一次 `npm install`（升级 dsh-llm-deepseek）
 * 或手工 patch 丢失，都会让这一行悄无声息地消失。那时：
 *
 *   · 请求照常成功，界面照常回话 —— 没有任何可见症状；
 *   · 只是 `assistant/message` 的 usage 里再也没有 cacheReadTokens；
 *   · 于是「命中率」变成一个无法观测的数字，成本失控也没有人会发现。
 *
 * 这类"没有症状的失效"必须由断言兜住，不能靠人记得。本脚本是只读的：
 * 它检查产物文本，不修改任何东西。
 *
 * 行为：
 *   · 产物存在 → 逐条硬断言，失败以退出码 1 阻断。
 *   · 产物不存在（CI 里没装 node_modules）→ **大声**打印跳过原因后退出 0。
 *     打印是刻意的：静默跳过会让"没检查"看起来像"检查通过"。
 */

// node:assert/strict 只导出 default，没有具名 `assert` —— 写成
// `import { assert } from ...` 会直接 SyntaxError（本脚本第一版就踩了）。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromDesktop = createRequire(join(desktopRoot, 'package.json'))

/**
 * 解析产物入口。找不到就返回 null —— 由调用方决定这是"跳过"还是"失败"。
 * `--entry <文件>` 用于负向对照：拿一份删掉关键行的副本，证明断言真的会红
 * （"新断言必须能被证明失败"是仓库纪律，见 docs/build-standard.md）。
 */
function resolveAdapterEntry() {
  const index = process.argv.indexOf('--entry')
  if (index >= 0 && process.argv[index + 1]) return resolve(process.argv[index + 1])
  try {
    return requireFromDesktop.resolve('@deepseek-ai/dsh-llm-deepseek')
  } catch {
    return null
  }
}

const entry = resolveAdapterEntry()
if (entry === null) {
  console.log('[llm-cache-observability] 跳过：未安装 @deepseek-ai/dsh-llm-deepseek。')
  console.log('[llm-cache-observability] 原因：本作业没有 apps/desktop/node_modules；这不是"通过"，只是"没检查"。')
  console.log('[llm-cache-observability] 要真正执行本守卫，请在有依赖的作业里运行。')
  process.exit(0)
}

const source = readFileSync(entry, 'utf8')

// ── 1. 请求必须显式索取流式用量 ───────────────────────────────────────────
// 少了它，OpenAI 兼容网关不会在流尾回传 usage（DeepSeek 官方端点会，
// 但 mimo.ezlook.top / aiaaa.cc 这类第三方网关不会）。
assert.match(
  source,
  /stream_options\s*:\s*\{\s*include_usage\s*:\s*true\s*\}/,
  '适配器不再发送 stream_options:{include_usage:true}；网关将不回传 usage，'
  + '缓存命中率与成本都将变成不可观测。若这是升级 dsh-llm-deepseek 导致，'
  + '说明手工 patch 丢了（见 docs/build-standard.md 的 npm 产物 patch 条款）。',
)

// ── 2. 必须仍然解析缓存字段 ───────────────────────────────────────────────
// 两种拼法都要认：DeepSeek 自有字段，以及 OpenAI 兼容的 prompt_tokens_details。
assert.match(
  source,
  /prompt_cache_hit_tokens|prompt_tokens_details/,
  '适配器不再解析 prompt_cache_hit_tokens / prompt_tokens_details；'
  + '即使网关回传了缓存字段，usage 里也不会出现 cacheReadTokens。',
)

// ── 3. 缓存命中必须被映射成 cacheReadTokens（会话日志与验收脚本的口径）────
assert.match(
  source,
  /cacheReadTokens/,
  '适配器不再产出 cacheReadTokens；tools/verify-cache-hit.mjs 与 docs/cache-hit-rate.md '
  + '描述的验收口径会失效。',
)

// ── 4. 注意 stream:true 与 include_usage 必须同时在场 ─────────────────────
// 只带 include_usage 但不走流式，等于两者都不生效。
assert.match(source, /stream\s*:\s*true/, '适配器不再以流式发起请求，include_usage 随之失效。')

console.log(`[llm-cache-observability] OK：${entry}`)
console.log('[llm-cache-observability] 已确认 4 项：stream:true / include_usage / 缓存字段解析 / cacheReadTokens 映射。')
