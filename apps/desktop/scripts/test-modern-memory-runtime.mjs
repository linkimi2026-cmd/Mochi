#!/usr/bin/env node
// Real candidate Host, Session events and model request payload; local deterministic gateway.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {JournalStore} from '../../../plugins/mochi-memory/journal-store.mjs';
import {defaultDbPath,openStore} from '../../../plugins/mochi-memory/mem-store.mjs';
const modules=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Pass isolated candidate node_modules');
const repo=resolve(import.meta.dirname,'../../..'),root=mkdtempSync(join(tmpdir(),'mochi-memory-host-')),home=join(root,'home');
const require=createRequire(import.meta.url),runtime=require(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const requests=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'本地验收已收到，这是一段用于检查会话事件的固定回复。'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let host;
try{
 mkdirSync(home);runtime.provisionMochiProfiles({homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(repo,'skills'),...(process.argv[4]?{pluginRoot:resolve(process.argv[4])}:{workspaceRoot:repo}),runtimeNodeModulesRoot:modules,role:'teacher'});
 const seedDb=openStore(defaultDbPath(home));
 try {new JournalStore(seedDb,{role:'teacher'}).recordActivity({id:'startup-test',kind:'conversation',at:Date.parse('2020-01-02T12:00:00Z'),summary:'当天实际交流了课堂观察的安排。'});}finally{seedDb.close();}
 const probe=join(root,'probe');mkdirSync(join(probe,'node_modules'),{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(probe,'node_modules/@deepseek-ai'));
 writeFileSync(join(probe,'package.json'),JSON.stringify({name:'memory-probe',type:'module',main:'index.mjs'}));
 writeFileSync(join(probe,'index.mjs'),`import assert from 'node:assert/strict';
 import {DatabaseSync} from 'node:sqlite';
 import {JournalStore} from ${JSON.stringify(pathToFileURL(join(repo,'plugins/mochi-memory/journal-store.mjs')).href)};
 import {JournalWriter} from ${JSON.stringify(pathToFileURL(join(repo,'plugins/mochi-memory/journal-writer.mjs')).href)};
 export const inject=['sessionController','agents','tools','commands','systemPrompt','llm'];
 export function apply(ctx){const timer=setTimeout(()=>void(async()=>{try{
 const signal=new AbortController().signal;
 const create=async()=>{const session=await ctx.sessionController.create({cwd:${JSON.stringify(root)},agentPreset:'standard'});return ctx.agents.get(session.sessionId)};
 const call=(agent,name,args)=>ctx.tools.get(name,agent).execute(args,{agent,signal,callId:'probe-'+name});
 let request=0;const prompt=async(agent,text)=>{const count=agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length;
 await ctx.sessionController.prompt({sessionId:agent.session.id,requestId:'probe-'+(++request),mode:'queue',content:[{type:'text',text}]},signal);
 const end=Date.now()+15000;while(agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length===count){if(Date.now()>end)throw Error('turn timeout');await new Promise(r=>setTimeout(r,40));}};
 const first=await create();const schemas=ctx.tools.schemas(first).map(x=>x.name);assert.ok(schemas.includes('write'),JSON.stringify(schemas));assert.ok(schemas.includes('mochi_call_student'));assert.ok(schemas.includes('mochi_memory_observe'));
 await prompt(first,'帮我生成 Word 文件');await prompt(first,'帮我输出 Word 文件');
 assert.equal((await call(first,'mochi_memory_list',{})).统计.总数,0);
 const second=await create();await prompt(second,'帮我生成 Word 文件');
 let list=await call(second,'mochi_memory_list',{});assert.equal(list.统计.总数,1,JSON.stringify(list));
 await prompt(second,'生成一份练习材料');
 await ctx.commands.execute(second,'/mochi-chat',[],signal);
 const chat=ctx.tools.schemas(second).map(x=>x.name);assert.ok(!chat.includes('write'));assert.ok(chat.includes('mochi_memory_observe'));
 await prompt(second,'我们班喜欢一起讨论为什么');
 const observation=await call(second,'mochi_memory_observe',{topic:'class_portrait',value:'discussion',summary:'班级喜欢共同讨论和提问。',quote:'我们班喜欢一起讨论为什么'});assert.equal(observation.status,'observing');
 await assert.rejects(()=>call(second,'mochi_memory_observe',{topic:'class_portrait',value:'imagined',summary:'班级喜欢安静阅读。',quote:'我们班喜欢安静阅读'}),/真实用户原句/);
 await call(second,'mochi_memory_forget',{id:list.记忆列表[0].记忆ID});
 await prompt(second,'帮我生成 Word 文件');assert.equal((await call(second,'mochi_memory_list',{})).统计.总数,0);
 const db=new DatabaseSync(${JSON.stringify(defaultDbPath(home))});
 try {
  const journal=new JournalStore(db,{role:'teacher'}),writer=new JournalWriter(journal,{stream:options=>ctx.llm.stream(options)});
  assert.ok(journal.get('diary:2020-01-02'),'startup must catch up a real past activity');
  const day=journal.recordedDates().at(-1);const diary=await writer.generate(day);assert.equal(diary.generator,'model');
  const preview=journal.summarizeRange({from:day,to:day});journal.saveGeneratedHistory({expectedRevision:journal.history().revision,body:preview.body,sourceEntryIds:preview.sourceEntryIds});
 }finally{db.close();}
 await prompt(second,'生成一份练习材料');
 console.log('MEMORY_PROBE='+JSON.stringify({passed:true,realSessionCapture:true,crossConversationLearning:true,chatMemoryTools:true,generalFullTools:true,semanticEvidenceChecked:true,forgottenNotRelearned:true,requests:request}));process.exit(0);
 }catch(e){console.error('MEMORY_PROBE_ERROR='+e.stack);process.exit(1)}})(),800);ctx.effect(()=>()=>clearTimeout(timer));}`);
 const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/memory-probe'));
 const manifest=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));manifest.dependencies['memory-probe']='link:'+probe;writeFileSync(join(profile,'package.json'),JSON.stringify(manifest));
 writeFileSync(join(profile,'cordis.patch.yml'),readFileSync(join(profile,'cordis.patch.yml'),'utf8')+`\n- id: agent-default-model\n  config: {provider: memory-fixture, model: fixture-model}\n- id: llm-pi-ai\n  config:\n    providers:\n      memory-fixture:\n        api: openai-completions\n        apiKeyEnv: MEMORY_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: fixture-model\n            name: Local fixture\n            input: [text]\n            contextWindow: 262144\n            maxTokens: 4096\n- insert:\n    - id: memory-probe\n      name: memory-probe\n`);
 const output=await new Promise((done,reject)=>{
  host=spawn(process.execPath,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:modules,DSH_TELEMETRY_DISABLED:'1',MEMORY_FIXTURE_KEY:'local-fixture'},stdio:['ignore','pipe','pipe']});
  let log='';const collect=chunk=>{log=(log+chunk).slice(-24000)};host.stdout.on('data',collect);host.stderr.on('data',collect);
  const timer=setTimeout(()=>{host.kill('SIGTERM');reject(Error('timeout\n'+log.replace(/token=\S+/g,'token=[redacted]')))},60000);
  host.once('error',reject);host.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(log.replace(/token=\S+/g,'token=[redacted]')));else done(log)});
 });
 const marker=output.split('\n').find(x=>x.startsWith('MEMORY_PROBE='));assert.ok(marker);const result=JSON.parse(marker.slice(13));
 const turns=requests.filter(body=>body.tools?.some(tool=>tool.function.name==='mochi_memory_note'));
 assert.equal(turns.length,7);
 const toolNames=body=>body.tools.map(tool=>tool.function.name);
 assert.ok(toolNames(turns[0]).includes('write'));assert.ok(toolNames(turns[0]).includes('mochi_call_student'));
 const memoryText=body=>JSON.stringify(body.messages.findLast(message=>message.role==='user'&&JSON.stringify(message.content).includes('Current runtime context.'))?.content??'');
 assert.match(memoryText(turns[0]),/Mochi 的历史资料/,'new Session first request must receive available history');
 assert.match(memoryText(turns[3]),/交付文件/);assert.match(memoryText(turns[3]),/暂定/);
 assert.ok(!toolNames(turns[4]).includes('write'));assert.ok(toolNames(turns[4]).includes('mochi_memory_observe'));
 assert.doesNotMatch(memoryText(turns[6]),/交付文件/);
 assert.match(memoryText(turns[6]),/Mochi 的历史资料/);
 assert.match(memoryText(turns[6]),/本地验收已收到/);
 const db=new DatabaseSync(defaultDbPath(home));
 let journalEvidence;
 try {
  const journal=new JournalStore(db,{role:'teacher'});
  const activities=db.prepare('SELECT date,data FROM mochi_journal_activities WHERE role=? AND id<>?').all('teacher','startup-test');
  assert.equal(activities.length,7,'Only seven actual user turns, excluding generated titles');
  assert.ok(activities.every(row=>JSON.parse(row.data).kind==='conversation'));
  const day=activities[0].date;
  const modelEntry=journal.get('diary:'+day);assert.equal(modelEntry.generator,'model');
  const diary=journal.generateDay(day);
  assert.equal(diary.sourceIds.length,7);
  assert.equal(journal.generateDay('2020-01-01'),null);
  assert.equal(new JournalStore(db,{role:'classroom'}).list().length,0);
  assert.ok(journal.get('diary:2020-01-02'));
  journalEvidence={actualCompletedTurns:activities.length,emptyDaySkipped:true,roleIsolation:true,localDraftSources:diary.sourceIds.length,officialLlmStream:true,historyInNextModelRequest:true,hostStartupCatchup:true};
 } finally {db.close();}
 const evidence={...result,actualGatewayPayload:true,paidModel:false,journal:journalEvidence,checks:['standard first request full tools','real user-message events across sessions','learned preference in runtime user context','manual chat retains memory tools','forget removes current memory snapshot; prior conversation history remains','completed real Session turns enter diary sources; no empty-day diary']};
 if(process.argv[3]){mkdirSync(resolve(process.argv[3],'..'),{recursive:true});writeFileSync(resolve(process.argv[3]),JSON.stringify(evidence,null,2)+'\n');}
 console.log(JSON.stringify(evidence,null,2));
}finally{host?.kill('SIGTERM');await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
