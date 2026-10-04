import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installReasoning, ReasoningStore, chooseReasoning, userText, reasoningState, advanceReasoning, POLICY_EVENT } from '../reasoning.mjs';
const capability = { efforts: ['off','low','medium','high','max'].map(id => ({id})), defaultEffort: 'high' };
const user = text => ({role:'user',content:[{type:'text',text}],source:{kind:'user'}});
function harness() {
  const hooks=new Map(), routes=[]; const session={id:'s',events:[],snapshotEvents(){return this.events},append(type,data){const event={type,data,seq:this.events.length};this.events.push(event);hooks.get('session/event')?.(this,event);return event}};
  const ctx={on(name,fn){hooks.set(name,fn);return()=>hooks.delete(name)},llm:{resolveModelInfo:async()=>({reasoning:capability})},connection:{fetch:{register(route){routes.push(route);return()=>{}}}},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'m'})},sessionController:{projections:async()=>({values:{modelSelection:{next:session.events.filter(e=>e.type==='model/selection').at(-1)?.data}}}),modelCatalog:async()=>({default:{provider:'fixture',model:'m'}}),resolveAgent:async()=>({agent:{session}}),selectModel:async input=>session.append('model/selection',input)}};
  const records=new Map(),store={get:id=>records.get(id),merge:(id,change)=>records.set(id,{...records.get(id),...change})};
  const dispose=installReasoning(ctx,store), agent={session},signal=new AbortController().signal;
  const request=()=>hooks.get('agent/request')({agent,turn:1,step:1,signal},async()=>({provider:'fixture',model:'m',reasoningEffort:'high'}));
  const step=messages=>hooks.get('agent/pre-step')({agent,turn:1,step:1,signal},async()=>({kind:'enter',messages}));
  return {ctx,hooks,session,agent,request,step,routes,dispose,store};
}
test('task rule uses the latest actual user message and preserves its multiple text parts',()=>{
 const messages=[user('请完整证明'+ '很长'.repeat(1300)),user('你好'),{role:'assistant',content:[{type:'text',text:'证明'}]}, {...user('证明'),source:{kind:'tool'}}];
 assert.equal(userText(messages),'你好');assert.equal(chooseReasoning(userText(messages),capability).effort,'low');
 const multi=user('快速回答');multi.content.push({type:'text',text:'一句话'});assert.equal(userText([multi]),'快速回答\n一句话');
 assert.equal(chooseReasoning('请分析成绩数据',capability).effort,'high');assert.equal(chooseReasoning('请帮我备课',capability).effort,'high');
});
test('only supported levels are selected; an undeclared capability emits no effort',()=>{
 assert.equal(chooseReasoning('证明', {efforts:[{id:'off'},{id:'low'}]}).effort,'low');
 assert.equal(chooseReasoning('你好',{efforts:[{id:'high'}]}).effort,'high');
 assert.equal(chooseReasoning('证明', undefined).effort,undefined);
 assert.equal(chooseReasoning('普通任务',{efforts:[{id:'custom'}],defaultEffort:'custom'}).effort,'custom');
});
test('old durable manual selection survives replay; in-flight old headers cannot replace a newer selection',()=>{
 const state=reasoningState([{type:'model/selection',data:{provider:'p',model:'m',reasoningEffort:'low'}}]);
 assert.equal(state.mode,'manual');advanceReasoning(state,{type:'request/header',data:{header:{config:{provider:'p',model:'old',reasoningEffort:'high'}}}});assert.equal(state.current.model,'m');
 advanceReasoning(state,{type:POLICY_EVENT,data:{mode:'auto'}});advanceReasoning(state,{type:'request/header',data:{header:{config:{provider:'p',model:'m',reasoningEffort:'medium'}}}});assert.equal(state.current.reasoningEffort,'medium');assert.equal(state.pending,undefined);
});
test('complex previous turn changes to low for a new greeting, and tool continuation retains this turn',async()=>{
 const h=harness();await h.step([user('请完整证明'+ '段落'.repeat(1300))]);assert.equal((await h.request()).reasoningEffort,'high');
 await h.step([user('请完整证明'+ '段落'.repeat(1300)),user('你好')]);assert.equal((await h.request()).reasoningEffort,'low');
 await h.step([{role:'tool',content:[{type:'text',text:'证明'}]}]);assert.equal((await h.request()).reasoningEffort,'low');h.dispose();
});
test('manual choice during capability lookup wins; unknown model removes a stale proposed effort',async()=>{
 const h=harness();let finish;h.ctx.llm.resolveModelInfo=()=>new Promise(resolve=>finish=resolve);
 const pending=h.request();await Promise.resolve();h.session.append('model/selection',{provider:'fixture',model:'m',reasoningEffort:'high'});finish({reasoning:capability});assert.equal((await pending).reasoningEffort,'high');
 h.session.append(POLICY_EVENT,{mode:'auto'});h.ctx.llm.resolveModelInfo=async()=>({});assert.equal(Object.hasOwn(await h.request(),'reasoningEffort'),false);h.dispose();
});
test('manual endpoint validates against actual capability; auto policy is durable and bounded',async()=>{
 const h=harness(),route=h.routes.find(x=>x.methods.includes('POST'));
 const send=body=>route.fetch(new Request('http://localhost/api/mochi-reasoning',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await send({sessionId:'s',mode:'manual',effort:'xhigh'})).status,400);
 assert.equal((await send({sessionId:'s',mode:'manual',effort:'low'})).status,200);assert.equal((await h.request()).reasoningEffort,'high'); // upstream supplies the manual selection; hooks do not rewrite it
 const response=await send({sessionId:'s',mode:'auto'});assert.equal((await response.json()).mode,'auto');assert.equal(h.store.get('s').autoAfterSeq,h.session.events.at(-1).seq);assert.equal(h.session.events.some(e=>e.type===POLICY_EVENT),false);
 assert.equal((await route.fetch(new Request('http://localhost/api/mochi-reasoning',{method:'POST',body:' '.repeat(1025)}))).status,400);h.dispose();
});

test('role-home sidecar merges sessions across instances, survives restart, and never writes raw tasks into logs',()=>{
 const root=mkdtempSync(join(tmpdir(),'reasoning-store-'));
 try{const path=join(root,'teacher/policy.json'),a=new ReasoningStore(path),b=new ReasoningStore(path);a.merge('one',{autoAfterSeq:3});b.merge('two',{autoAfterSeq:7});a.merge('one',{last:{effort:'low',reason:'本机规则',requestSeq:4}});
 assert.equal(new ReasoningStore(path).get('two').autoAfterSeq,7);assert.equal(b.get('one').autoAfterSeq,3);assert.equal(statSync(path).mode&0o777,0o600);assert.equal(new ReasoningStore(join(root,'classroom/policy.json')).get('one'),undefined);
 assert.equal(reasoningState([{type:'model/selection',seq:2,data:{provider:'p',model:'m',reasoningEffort:'high'}}],a.get('one')).mode,'auto');assert.equal(reasoningState([{type:'model/selection',seq:8,data:{provider:'p',model:'m',reasoningEffort:'high'}}],a.get('one')).mode,'manual');
 assert.throws(()=>a.merge('one',{body:'raw user task'}),/无效/);assert.throws(()=>a.merge('one',{last:{reason:'x'.repeat(1025)}}),/过长/);assert.ok(!readFileSync(path,'utf8').includes('raw user task'));
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('snapshot follows public per-session next selection or catalog default instead of an unrelated global default',async()=>{
 const h=harness(),route=h.routes[0];h.ctx.agentDefaultModel.currentSelection=()=>{throw Error('must not use the old global fallback')};
 h.ctx.sessionController.projections=async()=>({values:{modelSelection:{next:{provider:'session-route',model:'selected',reasoningEffort:'low'}}}});
 h.ctx.llm.resolveModelInfo=async(provider,model)=>{assert.equal(provider,'session-route');assert.equal(model,'selected');return {reasoning:capability}};
 let value=await (await route.fetch(new Request('http://localhost/api/mochi-reasoning?sessionId=s'))).json();assert.equal(value.current.model,'selected');assert.equal(value.efforts.length,5);
 h.ctx.sessionController.projections=async()=>({values:{modelSelection:{next:null}}});h.ctx.sessionController.modelCatalog=async()=>({default:{provider:'session-route',model:'selected'}});value=await (await route.fetch(new Request('http://localhost/api/mochi-reasoning?sessionId=s'))).json();assert.equal(value.mode,'auto');assert.equal(value.efforts.length,5);h.dispose();
});
test('metadata lookup failure is explicit and differs from a model without reasoning capability',async()=>{
 const h=harness();h.ctx.llm.resolveModelInfo=async()=>{throw Object.assign(Error('private upstream details'),{code:'NO_ADAPTER'})};
 const value=await (await h.routes[0].fetch(new Request('http://localhost/api/mochi-reasoning?sessionId=s'))).json();assert.equal(value.lookupError.code,'NO_ADAPTER');assert.equal(value.efforts.length,0);assert.ok(!JSON.stringify(value).includes('private upstream details'));h.dispose();
});


test('knowledge and ambiguous requests stay high even when short or explicitly brief',()=>{
 for(const input of ['惯性是什么？','1+1等于几？','一句话解释光合作用','快速回答：为什么天空是蓝色？','简短证明这个结论','请帮我备课','帮我把这篇论文总结一句话','请打开设置并解释牛顿定律','你好，什么是向心力？','请翻译这个词','hello, what is inertia?','thanks, explain gravity','普通任务','']) {
  assert.equal(chooseReasoning(input,capability).effort,'high',input);
 }
 for(const input of ['你好！','谢谢你','收到','hi','HELLO!','Thanks.','OK','thank you','请打开设置','帮我关闭摄像头','暂停监听','请新建会话','最小化窗口','清空输入框']) {
  assert.equal(chooseReasoning(input,capability).effort,'low',input);
 }
});

test('a short knowledge turn follows a low greeting and subsequent tool steps retain high',async()=>{
 const h=harness();await h.step([user('你好')]);assert.equal((await h.request()).reasoningEffort,'low');
 await h.step([user('你好'),user('什么是惯性？一句话回答')]);assert.equal((await h.request()).reasoningEffort,'high');
 await h.step([{role:'tool',content:[{type:'text',text:'result'}]}]);assert.equal((await h.request()).reasoningEffort,'high');h.dispose();
});


test('new image/file user inputs reset an earlier low greeting to high; runtime contexts do not become tasks',async()=>{
 for(const block of [{type:'image',attachment:{attachmentId:'fixture-image'}},{type:'file',attachment:{attachmentId:'fixture-file'}}]) {
  const h=harness();await h.step([user('你好')]);assert.equal((await h.request()).reasoningEffort,'low');
  await h.step([{role:'user',source:{kind:'context'},content:[{type:'text',text:'请深度分析'}]}]);assert.equal((await h.request()).reasoningEffort,'low');
  await h.step([{role:'user',source:{kind:'user'},content:[block]}]);assert.equal((await h.request()).reasoningEffort,'high');
  await h.step([{role:'tool',content:[{type:'text',text:'result'}]}]);assert.equal((await h.request()).reasoningEffort,'high');
  await h.step([user('你好')]);assert.equal((await h.request()).reasoningEffort,'low');
  await h.step([{...user('你好'),content:[{type:'text',text:'你好'},block]}]);assert.equal((await h.request()).reasoningEffort,'high');h.dispose();
 }
});
