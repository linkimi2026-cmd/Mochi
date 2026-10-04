#!/usr/bin/env node
// Actual alpha Session writer -> packaged rc.2 persistence; fixture data only.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const repo = resolve(import.meta.dirname, '../../..')
const script = resolve(import.meta.filename)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const artifacts = root => readdirSync(root, { recursive: true }).filter(file => /session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/u.test(file)).sort()

function assistant(session, llm, turn, step, blocks, finish = 'stop') {
  const assembler = new llm.BlockAssembler()
  const stream = new llm.AssistantStreamAccumulator()
  const chunks = blocks.flatMap((block, index) => [
    { type: 'block-start', index, blockType: block.type },
    { type: 'block-end', index, block },
  ])
  chunks.push({ type: 'finish', reason: { kind: finish } })
  for (const chunk of chunks) { assembler.push(chunk); stream.push({ time: Date.now(), chunk }) }
  const message = assembler.message({ kind: 'model', provider: 'fixture-only', model: 'migration-fixture' })
  session.append('assistant/message', { turn, step, message, stream: stream.snapshot() }, { surfaceOp: 'append' })
}

async function worker(stage, modules, configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const r = createRequire(join(modules, 'package.json'))
  const load = name => import(pathToFileURL(r.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const sessionApi = await load('@deepseek-ai/dsh-session')
  const llm = await load('@deepseek-ai/dsh-llm')
  const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const generation = r('@deepseek-ai/dsh-session/package.json').version
  assert.equal(generation, stage === 'alpha' ? '0.1.3-alpha.1' : '0.2.0-rc.2')
  if (stage !== 'alpha') assert.equal(process.versions.electron, '44.0.0')
  const ctx = new Context()
  const sessionPlugin = ctx.plugin(sessionApi.default)
  await sessionPlugin.await()
  const persistencePlugin = ctx.plugin(Persistence, { root: config.root, compression: config.compression })
  await persistencePlugin.await()
  const persistence = ctx.get('sessionPersistence')
  try {
    if (stage === 'alpha') {
      const session = ctx.get('sessions').create(sessionApi.SessionId(config.id), { meta: { cwd: config.cwd, agentPreset: 'standard' } })
      assert.equal(session.header.version, 2)
      // The exact canonical command vocabulary consumed by Mochi's mode fold.
      session.append('command/run', { commandId: 'fixture-mode-switch', name: 'mochi-chat', args: '', source: { kind: 'user' } })
      session.append('command/done', { commandId: 'fixture-mode-switch', kind: 'success', text: '已切到对话界面' })
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('request/header', { reason: 'initial', header: {
        config: { provider: 'fixture-only', model: 'migration-fixture' },
        system: 'Mochi记忆资料：老师希望保留Word文档。这里仅为迁移测试资料。',
      } })
      session.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请查找我保存的教学格式偏好。' }] }), { surfaceOp: 'append' })
      assistant(session, llm, 1, 1, [{ type: 'tool-call', id: 'fixture-memory-call', name: 'mochi_memory_search', arguments: '{"query":"教学格式"}' }], 'tool-calls')
      session.append('tool/call', { turn: 1, step: 1, callId: 'fixture-memory-call', name: 'mochi_memory_search', arguments: '{"query":"教学格式"}' })
      session.append('tool/result', { turn: 1, step: 1, message: llm.createToolResultMessage({ callId: 'fixture-memory-call', content: [{ type: 'text', text: 'fixture来源：老师希望保留Word文档。' }], isError: false }), meta: { fixtureOnly: true, memoryIds: ['fixture-memory-source'] } }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('step/start', { turn: 1, step: 2 })
      assistant(session, llm, 1, 2, [{ type: 'text', text: '已查到教学格式偏好，原始出处已保留。' }])
      session.append('step/end', { turn: 1, step: 2 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      if (config.torn) {
        session.append('turn/start', { turn: 2 })
        session.append('step/start', { turn: 2, step: 1 })
        session.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '中断前已提交的真实fixture文本。' }] }), { surfaceOp: 'append' })
      }
      const events = session.snapshotEvents()
      const handle = await persistence.create(session.header)
      await handle.append(events); await handle.flush(); await handle.close()
      const files = artifacts(config.root)
      assert.equal(files.length, 1)
      const path = join(config.root, files[0])
      if (config.torn) appendFileSync(path, config.compression === 'none' ? Buffer.from('{"seq":') : readFileSync(path).subarray(0, 3))
      const bytes = readFileSync(path)
      const result = { id: config.id, alphaVersion: generation, sourceHeader: session.header, events, artifact: files[0], bytes: bytes.length, sha256: sha(bytes), hasTornTail: config.torn }
      writeFileSync(config.source, JSON.stringify(result, null, 2) + '\n')
      console.log('RESULT=' + JSON.stringify({ id: config.id, alphaVersion: generation, format: 2, events: events.length, sourceSha256: result.sha256 }))
      return
    }
    const source = JSON.parse(readFileSync(config.source, 'utf8'))
    const original = readFileSync(join(config.root, source.artifact))
    assert.equal(sha(original), source.sha256)
    const assertSource = () => assert.deepEqual(readFileSync(join(config.root, source.artifact)), original, 'historical source bytes changed')
    if (stage === 'reopen') {
      const expected = JSON.parse(readFileSync(config.expected, 'utf8'))
      const handle = await persistence.open(sessionApi.SessionId(config.id), 'read')
      const read = await handle.read()
      assert.deepEqual(read.events, expected.events)
      assert.equal(handle.header.version, 4)
      assertSource(); await handle.close()
      console.log('RESULT=' + JSON.stringify({ coldReopen: true, events: read.events.length, electron: process.versions.electron, node: process.versions.node, sourceUnchanged: true }))
      return
    }
    const initialArtifacts = artifacts(config.root)
    const observed = await persistence.stat(sessionApi.SessionId(config.id))
    assert.equal(observed.header.version, 4)
    assert.equal((await persistence.list()).length, 1)
    const reader = await persistence.open(sessionApi.SessionId(config.id), 'read')
    const read = await reader.read()
    assert.equal(reader.header.version, 4)
    assert.equal(read.eventState, 'shared-frozen')
    assert.equal(Object.isFrozen(read.events[0].data), true)
    assert.deepEqual(artifacts(config.root), initialArtifacts, 'read must not publish a generation')
    assertSource()
    read.events.forEach((event, index) => assert.equal(event.seq, index))
    writeFileSync(config.expected + '.migration-read.json', JSON.stringify({ source: source.events, migrated: read.events }, null, 2))
    for (const event of source.events.filter(e => ['user/message', 'assistant/message', 'tool/result', 'command/run', 'command/done'].includes(e.type))) {
      let expected = event.data
      if (event.type === 'tool/result') {
        const message = event.data.message, block = message.content[0]
        assert.equal(block.type, 'tool-result')
        // Current tool messages flatten the old user-role result wrapper. Keep
        // identity, exact content/outcome, source and all tool-private metadata.
        expected = { ...event.data, message: { id: message.id, role: 'tool', source: message.source,
          toolCallId: block.toolCallId, content: block.content, isError: block.isError } }
      }
      const candidate = read.events.find(e => e.type === event.type && e.time === event.time && isDeepStrictEqual(e.data, expected))
      assert.ok(candidate, `source ${event.type} payload or time was lost`)
    }
    assert.equal(read.events.length, source.events.length + 2, 'initial empty head and its exact prompt replacement must be promoted')
    const modePath = join(modules, '../plugins/mochi-modes/modes.mjs')
    assert.ok(existsSync(modePath), 'packaged Mochi mode projection missing')
    const { modeProjection } = await import(pathToFileURL(modePath).href)
    const mode = read.events.reduce(modeProjection.apply, modeProjection.init(reader.header))
    assert.equal(mode.mode, 'chat'); assert.equal(mode.pending, null)
    const restored = sessionApi.Session.fromRestore(sessionApi.SessionId(config.id), read.events, reader.header, reader.inheritedEventCount, read.eventState)
    assert.ok(restored.deriveMessages().some(message => message.role === 'system' && JSON.stringify(message.content).includes('Mochi记忆资料')))
    await reader.close()
    const writer = await persistence.open(sessionApi.SessionId(config.id), 'write')
    assertSource()
    const newArtifacts = artifacts(config.root)
    assert.equal(newArtifacts.length, 2)
    assert.ok(newArtifacts.some(file => basename(file) === `session.v4.jsonl${config.compression === 'none' ? '' : '.zstd'}`))
    const before = await writer.read()
    assert.deepEqual(before.events, read.events)
    const closers = sessionApi.interruptedTurnClosers(before.events)
    assert.equal(closers.length, config.torn ? 2 : 0)
    if (config.torn) assert.equal(closers.at(-1).data.reason.kind, 'interrupted')
    if (closers.length) await writer.append(closers)
    const nextRead = await writer.read()
    const continued = sessionApi.Session.fromRestore(sessionApi.SessionId(config.id), nextRead.events, writer.header, writer.inheritedEventCount, nextRead.eventState)
    const turn = config.torn ? 3 : 2
    // Restore owns a new lifecycle marker; persist it with the continuation.
    const start = nextRead.events.length
    continued.append('turn/start', { turn }); continued.append('step/start', { turn, step: 1 })
    continued.append('user/message', llm.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '新版继续保存同一会话。' }] }), { surfaceOp: 'append' })
    assistant(continued, llm, turn, 1, [{ type: 'text', text: '新版已接续，旧记录没有重写。' }])
    continued.append('step/end', { turn, step: 1 }); continued.append('turn/end', { turn, reason: { kind: 'completed' } })
    await writer.append(continued.snapshotEvents(start)); await writer.flush()
    const final = await writer.read()
    assert.deepEqual(final.events.slice(0, read.events.length), read.events)
    final.events.forEach((event, index) => assert.equal(event.seq, index))
    assertSource(); await writer.close()
    writeFileSync(config.expected, JSON.stringify({ events: final.events }, null, 2) + '\n')
    console.log('RESULT=' + JSON.stringify({ alphaVersion: source.alphaVersion, modernVersion: generation, sourceFormat: 2, targetFormat: 4, sourceEvents: source.events.length, migratedEvents: read.events.length, continuedEvents: final.events.length, repairedClosers: closers.length, sourceSha256: source.sha256, sourceUnchanged: true, readDoesNotPublish: true, mode: mode.mode, memoryToolAndContextPreserved: true, electron: process.versions.electron, node: process.versions.node }))
  } finally { await persistencePlugin.dispose(); await sessionPlugin.dispose() }
}

if (process.argv[2] === '--worker') {
  await worker(process.argv[3], resolve(process.argv[4]), resolve(process.argv[5]))
} else {
  const alpha = resolve(process.argv[2] ?? join(repo, 'apps/desktop/node_modules'))
  const app = resolve(process.argv[3] ?? join(repo, 'apps/desktop/release/mac-arm64/Mochi.app'))
  const output = resolve(process.argv[4] ?? join(repo, 'docs/evidence/harness-upgrade-2026-09-30/session-migration'))
  const modern = join(app, 'Contents/Resources/mochi/node_modules')
  const binary = join(app, 'Contents/MacOS/Mochi')
  const alphaBinary = createRequire(join(alpha, 'package.json'))('electron')
  assert.ok(existsSync(binary)); assert.ok(existsSync(modern))
  mkdirSync(output, { recursive: true })
  const home = mkdtempSync(join(tmpdir(), 'mochi-session-migration-'))
  const run = (stage, modules, configPath, label) => new Promise((done, reject) => {
    const modernProcess = stage !== 'alpha'
    const child = spawn(modernProcess ? binary : alphaBinary, ['--expose-internals', script, '--worker', stage, modules, configPath], {
      cwd: home, env: { ...process.env, DSH_HOME: join(home, stage + '-home'), DSH_TELEMETRY_DISABLED: '1', ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''; child.stdout.on('data', chunk => logs += chunk); child.stderr.on('data', chunk => logs += chunk)
    const timeout = setTimeout(() => child.kill('SIGTERM'), 60000)
    child.once('error', reject); child.once('exit', code => {
      clearTimeout(timeout); writeFileSync(join(output, label + '.log'), logs)
      if (code !== 0) { reject(new Error(`${label} exited ${code}:\n${logs}`)); return }
      const marker = logs.split('\n').find(line => line.startsWith('RESULT='))
      assert.ok(marker, logs); done(JSON.parse(marker.slice(7)))
    })
  })
  const results = []
  for (const compression of ['none', 'zstd']) for (const torn of [false, true]) {
    const name = compression + (torn ? '-torn' : '-complete')
    const root = join(home, name)
    const config = { id: 'fixture-' + name, cwd: home, root, compression, torn, source: join(output, name + '-alpha.json'), expected: join(output, name + '-continued.json') }
    const configPath = join(home, name + '.json'); writeFileSync(configPath, JSON.stringify(config))
    const generated = await run('alpha', alpha, configPath, name + '-alpha')
    const migrated = await run('modern', modern, configPath, name + '-modern')
    console.log(`${name}: v${migrated.sourceFormat}→v${migrated.targetFormat} PASS; source unchanged`)
    const reopened = await run('reopen', modern, configPath, name + '-reopen')
    results.push({ name, generated, migrated, reopened })
  }
  const evidence = { fixtureOnly: true, paidCalls: false, userDataRead: false, alphaModules: alpha, alphaBinary, packagedModules: modern, packagedBinary: binary, retainedFixtureRoot: home, results }
  writeFileSync(join(output, 'session-migration-results.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, cases: results.length, evidence: join(output, 'session-migration-results.json') }))
}
