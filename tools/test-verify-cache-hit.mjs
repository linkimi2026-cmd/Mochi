import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import test from 'node:test'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'verify-cache-hit.mjs')

function usageEvent(inputTokens, cacheReadTokens) {
  const usage = { inputTokens, outputTokens: 10 }
  if (cacheReadTokens !== undefined) usage.cacheReadTokens = cacheReadTokens
  return { type: 'assistant/message', data: { usage } }
}

function runFixture(t, usages, threshold = '0.75') {
  const home = mkdtempSync(join(tmpdir(), 'mochi-verify-cache-hit-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const sessionDir = join(home, 'sessions', 'workspace-a', 'session-fixture')
  const fixtureBin = join(home, 'fixture-bin')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(fixtureBin)
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model' } } } },
    ...usages,
  ]
  const log = join(sessionDir, 'session.v2.jsonl')
  const plainLog = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  writeFileSync(`${log}.zstd`, zstdCompressSync(plainLog))
  writeFileSync(`${log}.zstd.plain`, plainLog)
  // Keep the usage/threshold tests portable on hosts without zstd. This shim stands
  // in for the CLI contract; the dedicated regression test below checks CLI absence.
  writeFileSync(join(fixtureBin, 'zstd'), '#!/bin/sh\nexec /bin/cat "$2.plain"\n')
  chmodSync(join(fixtureBin, 'zstd'), 0o755)
  const result = spawnSync(process.execPath, [SCRIPT, '--home', home, '--threshold', threshold], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fixtureBin },
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

test('mixed usage counts retain subset stats but cannot pass threshold with an unknown steady-state round', (t) => {
  const result = runFixture(t, [
    usageEvent(100, 0),
    usageEvent(10, 90),
    usageEvent(100),
    usageEvent(30, 70),
  ])

  assert.equal(result.code, 2, result.output)
  assert.match(result.output, /  3\s+n\/a\s+n\/a\s+n\/a\s+n\/a/)
  assert.match(result.output, /稳态已计数子集：命中 160 \/ prompt 200 = 80\.00%/)
  assert.match(result.output, /全程累计（已计数轮次）：命中 160 \/ prompt 300 = 53\.33%/)
  assert.match(result.output, /稳态验收：n\/a.*缺失或无效的 inputTokens \/ cacheReadTokens/)
  assert.doesNotMatch(result.output, /✓ 稳态命中率/)
})

test('all missing cache counts report n/a and make steady state indeterminate', (t) => {
  const result = runFixture(t, [usageEvent(100), usageEvent(120), usageEvent(130)])

  assert.equal(result.code, 2, result.output)
  assert.match(result.output, /稳态验收：n\/a.*缺失或无效的 inputTokens \/ cacheReadTokens/)
  assert.doesNotMatch(result.output, /稳态已计数子集：命中 0/)
  assert.doesNotMatch(result.output, /✓ 稳态命中率/)
})

test('fully counted rounds retain the existing aggregate and threshold behavior', (t) => {
  const result = runFixture(t, [usageEvent(100, 0), usageEvent(20, 80), usageEvent(20, 80)])

  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /稳态（第 2 轮起）：命中 160 \/ prompt 200 = 80\.00%/)
  assert.match(result.output, /全程累计（已计数轮次）：命中 160 \/ prompt 300 = 53\.33%/)
})

test('missing or invalid input tokens cannot fabricate a 100% steady-state hit rate', (t) => {
  for (const invalid of [undefined, -1, '0', 1.5]) {
    const result = runFixture(t, [usageEvent(100, 0), usageEvent(invalid, 80)])
    assert.equal(result.code, 2, result.output)
    assert.match(result.output, /稳态验收：n\/a.*缺失或无效的 inputTokens/u)
    assert.doesNotMatch(result.output, /稳态（第 2 轮起）|100\.00%|✓/u)
  }
})

test('missing zstd CLI fails closed for multiple frames even when frame one ends at a newline', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-verify-cache-hit-multiframe-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const sessionDir = join(home, 'sessions', 'workspace-a', 'session-multiframe')
  const emptyBin = join(home, 'empty-bin')
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(emptyBin)

  const header = { type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model' } } } }
  // If only frame one is decoded, its two usage rows misleadingly report 99% steady hit rate.
  const firstFrame = [header, usageEvent(100, 0), usageEvent(1, 99)]
  const secondFrame = [usageEvent(100, 0)]
  const compressed = Buffer.concat([
    zstdCompressSync(`${firstFrame.map((event) => JSON.stringify(event)).join('\n')}\n`),
    zstdCompressSync(`${secondFrame.map((event) => JSON.stringify(event)).join('\n')}\n`),
  ])
  writeFileSync(join(sessionDir, 'session.v2.jsonl.zstd'), compressed)

  const result = spawnSync(process.execPath, [SCRIPT, '--home', home, '--threshold', '0.75'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: emptyBin },
  })
  const output = `${result.stdout}${result.stderr}`

  assert.equal(result.status, 2, output)
  assert.match(output, /没有 zstd 命令/)
  assert.match(output, /拒绝用可能不完整的数据算命中率/)
  assert.doesNotMatch(output, /稳态命中率|99\.00%|✓/)
})
