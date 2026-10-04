#!/usr/bin/env node
// Real classroom Host and model payload, with a legacy teacher-observation database fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createStore,openStore,defaultDbPath} from '../../../plugins/mochi-memory/mem-store.mjs';
import {ProactiveMemory} from '../../../plugins/mochi-memory/proactive.mjs';
const modules=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Pass isolated candidate node_modules');
const repo=resolve(import.meta.dirname,'../../..'),root=mkdtempSync(join(tmpdir(),'mochi-memory-role-host-')),home=join(root,'classroom');
const require=createRequire(import.meta.url),runtime=require(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs')),requests=[];
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'本地角色记忆验收。'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`)});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let host;
try{
 runtime.provisionMochiProfiles({homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(repo,'skills'),workspaceRoot:repo,runtimeNodeModulesRoot:modules,role:'classroom'});
 const store=createStore(openStore(defaultDbPath(home))),legacy=new ProactiveMemory(store,{role:'teacher'});
 const observations=[
  {topic:'file_format',value:'word',summary:'教师自动格式习惯：交付文件选择Word。',quote:'帮我生成Word文件'},
  {topic:'layout_style',value:'columns',summary:'教师自动排版习惯：选择分栏课件。',quote:'我喜欢分栏课件'},
  {topic:'communication_style',value:'concise',summary:'教师自动沟通习惯：选择简洁回答。',quote:'我喜欢简洁回答'},
  {topic:'class_portrait',value:'discussion',summary:'班级喜欢共同讨论和提问。',quote:'我们班喜欢一起讨论为什么'},
 ];
 for(const observation of observations)for(let i=0;i<3;i++)legacy.observe(observation,{sessionId:'legacy-'+i,messageId:observation.topic+'-'+i,text:observation.quote});
 const explicit=store.note({kind:'preference',content:'用户明确要求：Word课件保留讨论题。',source:'explicit_request'});
 const baseline=store.db.prepare('SELECT COUNT(*) AS count FROM mochi_memory_observations').get().count;store.db.close();
 const probe=join(root,'probe');mkdirSync(join(probe,'node_modules'),{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(probe,'node_modules/@deepseek-ai'));writeFileSync(join(probe,'package.json'),JSON.stringify({name:'memory-role-probe',type:'module',main:'index.mjs'}));
 writeFileSync(join(probe,'index.mjs'),`export const inject=['sessionController','agents','tools'];export function apply(ctx){const timer=setTimeout(()=>void(async()=>{try{const signal=new AbortController().signal;for(let i=0;i<3;i++){const session=await ctx.sessionController.create({cwd:${JSON.stringify(root)},agentPreset:'classroom'});const agent=ctx.agents.get(session.sessionId);await ctx.sessionController.prompt({sessionId:session.sessionId,requestId:'role-memory-'+i,mode:'queue',content:[{type:'text',text:'ROLE_MEMORY_TURN_'+i+' 请生成Word文件，用简洁分栏课件介绍我们班的讨论互动。'}]},signal);const end=Date.now()+15000;while(!agent.session.snapshotEvents().some(e=>e.type==='turn/end')){if(Date.now()>end)throw Error('turn timeout');await new Promise(r=>setTimeout(r,40));}}console.log('ROLE_MEMORY_PROBE=true');process.exit(0)}catch(e){console.error(e.stack);process.exit(1)}})(),800);ctx.effect(()=>()=>clearTimeout(timer));}`);
 const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/memory-role-probe'));const manifest=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));manifest.dependencies['memory-role-probe']='link:'+probe;writeFileSync(join(profile,'package.json'),JSON.stringify(manifest));
 writeFileSync(join(profile,'cordis.patch.yml'),readFileSync(join(profile,'cordis.patch.yml'),'utf8')+`\n- id: agent-default-model\n  config: {provider: role-fixture, model: fixture-model}\n- id: llm-pi-ai\n  config:\n    providers:\n      role-fixture:\n        api: openai-completions\n        apiKeyEnv: ROLE_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: fixture-model\n            name: Local fixture\n            input: [text]\n            contextWindow: 262144\n            maxTokens: 4096\n- insert:\n    - id: memory-role-probe\n      name: memory-role-probe\n`);
 const output=await new Promise((done,reject)=>{host=spawn(process.execPath,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:modules,DSH_TELEMETRY_DISABLED:'1',ROLE_FIXTURE_KEY:'local-fixture'},stdio:['ignore','pipe','pipe']});let log='';const collect=chunk=>{log=(log+chunk).slice(-64000)};host.stdout.on('data',collect);host.stderr.on('data',collect);const timer=setTimeout(()=>{host.kill('SIGTERM');reject(Error('timeout\n'+log.replace(/token=\S+/g,'token=[redacted]')))},60000);host.once('error',reject);host.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(log.replace(/token=\S+/g,'token=[redacted]')));else done(log)})});assert.ok(output.includes('ROLE_MEMORY_PROBE=true'));
 const turns=requests.filter(body=>body.tools?.some(t=>t.function.name==='mochi_memory_note')&&body.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('ROLE_MEMORY_TURN_')));assert.equal(turns.length,3);
 for(const turn of turns){const policy=JSON.stringify(turn.messages.filter(m=>m.role==='system'));assert.match(policy,/主动观察仅限班级共同/);const current=JSON.stringify(turn.messages.findLast(m=>m.role==='user'&&JSON.stringify(m.content).includes('Current runtime context.'))?.content??'');assert.ok(!current.includes('教师自动'));assert.match(current,/班级喜欢共同讨论和提问/);assert.match(current,/用户明确要求：Word课件保留讨论题/);}
 const reopened=createStore(openStore(defaultDbPath(home)));try{assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM mochi_memory_observations').get().count,baseline,'three actual classroom Word/layout/communication requests create no automatic observations');assert.ok(reopened.listAll().some(n=>n.id===explicit.id));assert.equal(reopened.stats().total,5,'legacy data is preserved, not deleted');}finally{reopened.db.close();}
 const evidence={passed:true,completeClassroomHost:true,actualSessionRequests:3,actualGatewayPayload:true,legacyTeacherAutomaticTopicsFiltered:['file_format','layout_style','communication_style'],classPortraitPreserved:true,explicitWordMemoryPreserved:true,observationsBefore:baseline,observationsAfter:baseline,legacyDataPreserved:true,paidModel:false};if(process.argv[3]){mkdirSync(resolve(process.argv[3],'..'),{recursive:true});writeFileSync(resolve(process.argv[3]),JSON.stringify(evidence,null,2)+'\n');}console.log(JSON.stringify(evidence,null,2));
}finally{host?.kill('SIGTERM');server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
