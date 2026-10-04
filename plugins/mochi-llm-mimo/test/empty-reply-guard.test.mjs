import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, copyFileSync, symlinkSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// This modern-only export must not accidentally resolve the retained alpha tree.
const modules = resolve(import.meta.dirname, '../../../apps/desktop/runtime-modern/node_modules')
const requireModern = createRequire(join(modules, '@deepseek-ai/dsh/package.json'))
const stage = mkdtempSync(join(tmpdir(), 'mochi-empty-guard-unit-'))
symlinkSync(modules, join(stage, 'node_modules'))
copyFileSync(resolve(import.meta.dirname, '../empty-reply-guard.mjs'), join(stage, 'guard.mjs'))
after(() => rmSync(stage, { recursive: true, force: true }))
const { markAgentLoopRequest } = await import(pathToFileURL(requireModern.resolve('@deepseek-ai/dsh-llm')).href)
const { apply, guardReply, EMPTY_REPLY, EMPTY_REPLY_FINAL } = await import(pathToFileURL(join(stage, 'guard.mjs')).href)

const finish = kind => ({ type: 'finish', reason: { kind } })
const reasoning = { type: 'block-end', index: 0, block: { type: 'reasoning', text: '思考' } }
const text = value => ({ type: 'block-end', index: 1, block: { type: 'text', text: value } })
const tool = { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call', name: 'fixture', arguments: '{}' } }
async function* stream(chunks) { yield* chunks }
async function collect(iterable) { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }

test('only empty/whitespace/reasoning-only stop is classified, while text and tools remain untouched', async () => {
  for (const chunks of [[finish('stop')], [reasoning,finish('stop')], [text(' \n'),finish('stop')]]) {
    assert.equal((await collect(guardReply(stream(chunks)))).at(-1).reason.failure.code,EMPTY_REPLY)
  }
  for (const chunks of [[reasoning,text('答复'),finish('stop')], [tool,finish('stop')], [tool,finish('tool-calls')], [reasoning,finish('max-tokens')], [finish('aborted')]]) {
    assert.deepEqual(await collect(guardReply(stream(chunks))),chunks)
  }
  const empty={type:'finish',reason:{kind:'error',failure:{code:'EMPTY_RESPONSE',message:'empty'}}}
  assert.equal((await collect(guardReply(stream([empty])))).at(-1).reason.failure.code,EMPTY_REPLY)
});

test('the single supplement cannot execute tools and terminal failures have a non-retry code', async () => {
  for (const chunks of [[reasoning,finish('stop')], [reasoning,finish('max-tokens')], [tool,text('done'),finish('tool-calls')], [{type:'finish',reason:{kind:'error',failure:{code:'SERVER',message:'upstream'}}}]]) {
    assert.equal((await collect(guardReply(stream(chunks),{supplement:true}))).at(-1).reason.failure.code,EMPTY_REPLY_FINAL)
  }
  const controller=new AbortController();controller.abort(new Error('cancelled'))
  await assert.rejects(collect(guardReply(stream([text('answer'),finish('stop')]),{signal:controller.signal})),/cancelled/)
});

test('public hooks restrict recovery to a true MiMo agent request and short-circuit downstream always retry', async () => {
  const events=new Map(),controller=new AbortController(),agent={session:{snapshotEvents:()=>[{type:'turn/start',data:{turn:1}}]}}
  let supplementary,downstream=0
  const ctx={agents:{get:id=>id==='session'?agent:undefined},on:(event,handler,options)=>{events.set(event,{handler,options});},llm:{stream:request=>{supplementary=request;return events.get('llm/stream').handler(request,()=>stream([text('恢复正文'),finish('stop')]))}}}
  apply(ctx)
  const hook=events.get('llm/stream').handler,recover=events.get('agent/request-error').handler
  const request={provider:'mochi-mimo',sessionId:'session',messages:[],tools:[{name:'fixture'}],signal:controller.signal}
  const raw=stream([reasoning,finish('stop')]);assert.equal(hook(request,()=>raw),raw,'non-loop helper generation is unaffected')
  const first=await collect(hook(markAgentLoopRequest(request),()=>stream([reasoning,finish('stop')])))
  const payload={agent,turn:1,provider:'mochi-mimo',failure:first.at(-1).reason.failure,signal:controller.signal,retryPolicy:{mode:'always'}}
  assert.deepEqual(recover(payload,()=>{downstream++;return {kind:'retry'}}),{kind:'retry'})
  const answer=await collect(hook(markAgentLoopRequest({...request}),()=>{throw Error('original stream must not be dispatched for supplement')}))
  assert.equal(answer.at(-1).reason.kind,'stop');assert.deepEqual(supplementary.tools,[])
  assert.equal(supplementary.messages.at(-1).role,'user');assert.equal(request.messages.length,0)
  assert.equal(recover(payload,()=>{downstream++;return {kind:'retry'}}),undefined)
  assert.equal(downstream,0);assert.equal(events.get('agent/request-error').options.prepend,true)
  assert.equal(recover({...payload,failure:{code:EMPTY_REPLY_FINAL}},()=>{downstream++;return {kind:'retry'}}),undefined)
  controller.abort(new Error('cancelled'));assert.throws(()=>recover(payload,()=>{}),/cancelled/)
});
