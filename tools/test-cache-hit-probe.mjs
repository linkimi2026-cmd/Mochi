import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'cache-hit-probe.mjs')
const SECRET = 'PRIVATE_CAPTURE_TEXT_78453'
const FAKE_KEY = 'FAKE_TEST_KEY_92144'

async function setup(t, response = null) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({ body: JSON.parse(raw), authorization: req.headers.authorization })
    if (response) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(response)
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"synthetic assistant"}}]}\n\n'
      + 'data: {"usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens":2}}\n\n'
      + 'data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const root = mkdtempSync(join(tmpdir(), 'mochi-cache-probe-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tools'))
  mkdirSync(join(root, 'secrets'))
  copyFileSync(SOURCE, join(root, 'tools/cache-hit-probe.mjs'))
  writeFileSync(join(root, 'secrets/packaging-keys.local.yaml'), `providers:\n  fake:\n    baseURL: http://127.0.0.1:${server.address().port}\n    apiKeyEnv: FAKE_KEY\n    defaultModel: fallback-model\ncredentialsRefs:\n  FAKE_KEY: ${FAKE_KEY}\n`)
  return { root, requests }
}

function run(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'tools/cache-hit-probe.mjs'), '--provider', 'fake', ...args], { cwd: root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output: stdout + stderr }))
  })
}

function capturedRequest() {
  return {
    model: 'captured-model',
    messages: [
      { role: 'system', content: `system ${SECRET}`, name: 'teacher' },
      { role: 'system', content: 'second system stays fixed' },
      { role: 'user', content: `question ${SECRET}` },
    ],
    tools: [{ type: 'function', function: { name: 'safe_tool', description: `schema ${SECRET}`, parameters: { type: 'object', properties: {} } } }],
  }
}

test('request-file replays captured first request and appends only later synthetic turns', async (t) => {
  const { root, requests } = await setup(t)
  const captured = capturedRequest()
  writeFileSync(join(root, 'capture.json'), JSON.stringify(captured))
  const result = await run(root, ['--request-file', 'capture.json', '--turns', '3'])

  assert.equal(result.code, 0, result.output)
  assert.equal(requests.length, 3)
  assert.equal(requests[0].body.model, captured.model)
  assert.deepEqual(requests[0].body.messages, captured.messages)
  assert.deepEqual(requests[0].body.tools, captured.tools)
  assert.equal(requests[0].body.stream, true)
  assert.deepEqual(requests[0].body.stream_options, { include_usage: true })
  assert.equal(requests[0].authorization, `Bearer ${FAKE_KEY}`)
  assert.deepEqual(requests[1].body.messages.slice(0, captured.messages.length), captured.messages)
  assert.deepEqual(requests[1].body.messages.slice(-2).map((message) => message.role), ['assistant', 'user'])
  assert.deepEqual(requests[2].body.messages.slice(-4).map((message) => message.role), ['assistant', 'user', 'assistant', 'user'])
  assert.ok(!result.output.includes(SECRET))
  assert.ok(!result.output.includes(FAKE_KEY))
  assert.ok(!result.output.includes('authorization'))
})

test('nonce modifies only the first system text; repeat keeps the exact same request', async (t) => {
  const { root, requests } = await setup(t)
  const captured = capturedRequest()
  writeFileSync(join(root, 'capture.json'), JSON.stringify(captured))
  const result = await run(root, ['--request-file', 'capture.json', '--repeat', '2', '--nonce', '--model', 'override-model'])

  assert.equal(result.code, 0, result.output)
  assert.equal(requests.length, 2)
  assert.match(requests[0].body.messages[0].content, /^\[run-[a-z0-9]+\]\nsystem /)
  assert.equal(requests[0].body.messages[1].content, captured.messages[1].content)
  assert.equal(requests[0].body.messages[2].content, captured.messages[2].content)
  assert.equal(requests[0].body.model, 'override-model')
  assert.deepEqual(requests[0].body, requests[1].body)
  assert.ok(!result.output.includes(SECRET))
  assert.ok(!result.output.includes(FAKE_KEY))
})

test('request-file rejects extra fields, invalid messages, incompatible modes, and nonce without system', async (t) => {
  const { root, requests } = await setup(t)
  const captured = capturedRequest()
  const cases = [
    [{ ...captured, headers: { authorization: FAKE_KEY } }, ['--turns', '1']],
    [{ ...captured, messages: [{}] }, ['--turns', '1']],
    [{ ...captured, tools: [{ type: 'function', function: { name: 'bad.name' } }] }, ['--turns', '1']],
    [{ ...captured, messages: [{ role: 'user', content: 'hello' }] }, ['--turns', '1', '--nonce']],
    [captured, ['--turns', '1', '--tools-file', 'capture.json']],
    [captured, ['--turns', '1', '--switch-at', '1']],
  ]
  for (const [body, args] of cases) {
    writeFileSync(join(root, 'capture.json'), JSON.stringify(body))
    const result = await run(root, ['--request-file', 'capture.json', ...args])
    assert.equal(result.code, 1, result.output)
    assert.ok(!result.output.includes(SECRET))
    assert.ok(!result.output.includes(FAKE_KEY))
  }
  assert.equal(requests.length, 0)
})

test('request-file without system can replay when nonce is absent', async (t) => {
  const { root, requests } = await setup(t)
  const captured = { ...capturedRequest(), messages: [{ role: 'user', content: SECRET }] }
  writeFileSync(join(root, 'capture.json'), JSON.stringify(captured))
  const result = await run(root, ['--request-file', 'capture.json', '--turns', '1'])
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(requests[0].body.messages, captured.messages)
})

test('response error body is hidden', async (t) => {
  const { root, requests } = await setup(t, `{"error":"${SECRET} ${FAKE_KEY} authorization"}`)
  writeFileSync(join(root, 'capture.json'), JSON.stringify(capturedRequest()))
  const result = await run(root, ['--request-file', 'capture.json', '--repeat', '1'])
  assert.equal(result.code, 2, result.output)
  assert.equal(requests.length, 1)
  assert.ok(!result.output.includes(SECRET))
  assert.ok(!result.output.includes(FAKE_KEY))
  assert.ok(!result.output.includes('authorization'))
})

test('existing tools-file switch-at mode still uses the simplified persona', async (t) => {
  const { root, requests } = await setup(t)
  const persona = join(root, 'persona.yml')
  writeFileSync(persona, 'persona: >-\n  simplified host persona\n')
  writeFileSync(join(root, 'tools.json'), JSON.stringify({ tools: [
    { type: 'function', function: { name: 'one' } },
    { type: 'function', function: { name: 'two' } },
  ] }))
  const result = await run(root, ['--tools-file', 'tools.json', '--persona-file', persona, '--switch-at', '1'])
  assert.equal(result.code, 0, result.output)
  assert.equal(requests.length, 4)
  assert.equal(requests[0].body.messages[0].content, 'simplified host persona')
  assert.equal(requests[0].body.tools.length, 1)
  assert.equal(requests[1].body.tools.length, 2)
  assert.match(result.output, /仅按数组截取模拟工具面变化/)
})
