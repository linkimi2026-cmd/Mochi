// Actual App44/rc.2 Host with a source-only guard/profile overlay and local SSE fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync,readdirSync,cpSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const repo=resolve(import.meta.dirname,'../../..'),app=resolve(process.argv[2]??'/Applications/Mochi.app');
const resources=join(app,'Contents/Resources/mochi'),modules=join(resources,'node_modules'),binary=join(app,'Contents/MacOS/Mochi');
const runtime=createRequire(import.meta.url)(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const yaml=createRequire(join(modules,'@deepseek-ai/dsh/package.json'))('yaml');
const root=mkdtempSync(join(tmpdir(),'mochi-empty-reply-')),calls=[],results=[];
let child,log='',origin,cookie,activeCase='text';
const supplement=body=>JSON.stringify(body.messages).includes('上一轮模型输出没有正文');
const isAgent=body=>body.tools?.length||supplement(body);
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 const recovery=supplement(body),agent=Boolean(isAgent(body));calls.push({case:activeCase,recovery,agent,tools:body.tools?.length??0});
 if(agent&&activeCase==='cancel'&&recovery){res.on('close',()=>{});return;}
 let delta={content:'固定本地正文'},finish='stop';
 if(agent){
  if(activeCase==='tool-then-empty'&&!recovery&&!body.messages.some(message=>message.role==='tool')){delta={tool_calls:[{index:0,id:'call_once',type:'function',function:{name:'empty_reply_fixture_tool',arguments:'{}'}}]};finish='tool_calls';}
  else if(activeCase==='recovery-tool'&&recovery){delta={tool_calls:[{index:0,id:'call_forbidden',type:'function',function:{name:'empty_reply_fixture_tool',arguments:'{}'}}]};finish='tool_calls';}
  else if(activeCase==='empty-both'||activeCase==='empty-first'&&!recovery){delta={};}
  else if(activeCase==='whitespace'&&!recovery){delta={content:' \n'};}
  else if(activeCase!=='text'&&!recovery){delta={reasoning_content:'这是只有思考的真实协议片段'};}
 }
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\ndata: [DONE]\n\n`);
});
async function until(fn,label){const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(label+'\n'+log.replace(/token=\S+/g,'token=[redacted]').slice(-6000));}
async function api(body){const response=await fetch(origin+'/api/empty-reply-fixture',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const text=await response.text();assert.ok(response.ok,text+"\n"+log.replace(/token=\S+/g,"token=[redacted]").slice(-7000));return JSON.parse(text);}
async function stop(){if(!child||child.exitCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;child=undefined;}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const stage=join(root,'stage'),plugins=join(stage,'plugins');mkdirSync(plugins,{recursive:true});symlinkSync(modules,join(stage,'node_modules'));symlinkSync(join(resources,'teacher-agent-presets'),join(stage,'teacher-agent-presets'));
 for(const name of readdirSync(join(resources,'plugins'))){if(name==='mochi-llm-mimo')cpSync(join(repo,'plugins/mochi-llm-mimo'),join(plugins,name),{recursive:true,filter:path=>!path.includes('/node_modules')});else symlinkSync(join(resources,'plugins',name),join(plugins,name));}
 const probe=join(stage,'probe');mkdirSync(probe);writeFileSync(join(probe,'package.json'),JSON.stringify({name:'empty-reply-fixture',type:'module',main:'index.mjs'}));
 writeFileSync(join(probe,'index.mjs'),`import {defineTool} from '@deepseek-ai/dsh-tools';export const inject=['sessionController','agents','connection','workspaceController','tools'];export function apply(ctx){let workspaceId,executions=0;ctx.tools.register(defineTool({name:'empty_reply_fixture_tool',description:'Local fixture counter only',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:'本地计数已执行'}]},execute:async()=>({executions:++executions})}));ctx.connection.fetch.register({path:'/api/empty-reply-fixture',methods:['POST'],requestBody:'buffered',fetch:async request=>{try{const x=await request.json();if(x.action==='ready'){workspaceId=(await ctx.workspaceController.create({path:${JSON.stringify(root)}})).workspace.workspaceId;return Response.json({electron:process.versions.electron});}if(x.action==='create')return Response.json(await ctx.sessionController.create({workspaceId}));const found=await ctx.sessionController.resolveAgent(x.sessionId);if(found.error)throw Error('Unavailable session');const agent=found.agent;if(x.action==='cancel'){agent.cancel({kind:'user'});return Response.json({cancelled:true});}const count=agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length;await ctx.sessionController.prompt({sessionId:x.sessionId,requestId:'fixture-'+Date.now(),mode:'queue',content:[{type:'text',text:'本地空回复测试 '+x.case}]},new AbortController().signal);const end=Date.now()+20000;while(agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length===count){if(Date.now()>end)throw Error('turn timed out');await new Promise(r=>setTimeout(r,20));}const events=agent.session.snapshotEvents();return Response.json({executions,reason:events.filter(e=>e.type==='turn/end').at(-1).data.reason,attempts:events.filter(e=>e.type==='assistant/attempt').length,assistant:events.filter(e=>e.type==='assistant/message').map(e=>e.data.message.content)});}catch(error){return Response.json({error:String(error.stack)},{status:400});}}});}`);
 for(const role of ['teacher','classroom']){
  const home=join(root,role);mkdirSync(home);const options={homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(resources,'skills'),pluginRoot:plugins,runtimeNodeModulesRoot:modules,role};runtime.provisionMochiProfiles(options);
  const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/empty-reply-fixture'));
  const manifestPath=join(profile,'package.json'),manifest=JSON.parse(readFileSync(manifestPath));manifest.dependencies['empty-reply-fixture']='link:'+probe;writeFileSync(manifestPath,JSON.stringify(manifest));
  const patch=join(profile,'cordis.patch.yml'),doc=yaml.parseDocument(readFileSync(patch,'utf8'));
  function update(sequence){if(!yaml.isSeq(sequence))return;for(const row of sequence.items){if(!yaml.isMap(row))continue;update(row.get('insert',true));const providers=row.get('config',true)?.get('providers',true);if(providers?.has('mochi-mimo'))providers.set('mochi-mimo',{api:'openai-completions',apiKeyEnv:'EMPTY_REPLY_FIXTURE_KEY',baseURL:'http://127.0.0.1:'+server.address().port+'/v1',compat:{thinkingFormat:'deepseek',maxTokensField:'max_tokens'},retryPolicy:{mode:'always',backoff:{initialDelayMs:1,maxDelayMs:1,jitterRatio:0}},models:[{id:'fixture',input:['text'],contextWindow:8192,maxTokens:128,reasoningEfforts:{off:null,low:'low',medium:'medium',high:'high'}}]});}}
  update(doc.contents);writeFileSync(patch,String(doc)+"\n- id: agent-default-model\n  config: {provider: mochi-mimo, model: fixture}\n- insert:\n    - id: empty-reply-fixture\n      name: empty-reply-fixture\n");runtime.provisionMochiProfiles(options);
  log='';child=spawn(binary,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:root,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',DSH_TELEMETRY_DISABLED:'1',EMPTY_REPLY_FIXTURE_KEY:'loopback-only',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk);
  const url=await until(()=>{if(child.exitCode!==null)throw Error(log.replace(/token=\S+/g,'token=[redacted]'));return log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0];},'Host startup');origin=new URL(url).origin;const response=await fetch(url,{redirect:'manual'});cookie=response.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ');assert.equal((await api({action:'ready'})).electron,'44.0.0');
  for(const name of role==='teacher'?['text','reasoning-first','empty-first','whitespace','empty-both','tool-then-empty','recovery-tool','cancel']:['reasoning-first','empty-both']){
   activeCase=name;const sessionId=(await api({action:'create'})).sessionId,before=calls.length;
   const pending=api({action:'run',sessionId,case:name});
   if(name==='cancel'){await until(()=>calls.slice(before).filter(x=>x.agent).length===2,'supplement starts');await api({action:'cancel',sessionId});}
   const result=await pending,agentCalls=calls.slice(before).filter(x=>x.agent);
   assert.equal(agentCalls.length,name==='text'?1:name==='tool-then-empty'?3:2,role+' '+name+' exact calls '+JSON.stringify(agentCalls));
   if(name==='empty-both'||name==='recovery-tool'){assert.equal(result.reason.kind,'error');assert.equal(result.reason.error.code,'MOCHI_EMPTY_REPLY_FINAL');}
   else if(name==='cancel')assert.equal(result.reason.kind,'aborted');
   else {assert.equal(result.reason.kind,'completed');assert.ok(result.assistant.flat().some(block=>block.type==='text'&&block.text==='固定本地正文'));}
   if(name==='recovery-tool')assert.equal(result.executions,1,'forbidden second tool must not execute');
   if(name==='tool-then-empty')assert.equal(result.executions,1,'already executed tool must not replay');
   assert.ok(agentCalls.filter(x=>x.recovery).every(x=>x.tools===0));
   results.push({role,case:name,calls:agentCalls.length,reason:result.reason,attempts:result.attempts,toolExecutions:result.executions});
  }
  await stop();console.log('PASS: '+role+' actual MiMo route guard');
 }
 writeFileSync(join(repo,'docs/evidence/harness-upgrade-2026-09-30/empty-reply-runtime.json'),JSON.stringify({passed:true,runtime:'actual installed App44/rc.2 RUN_AS_NODE',sourceGuardAndProfileOverlay:true,retryPolicy:'always',realUserHome:false,paidModel:false,results},null,2)+'\n');
}finally{await stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
