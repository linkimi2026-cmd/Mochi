// Actual rc.2 Host events through a loopback-only model; no GUI or microphone.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync,readdirSync,cpSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const repo=resolve(import.meta.dirname,'../../..'),app=resolve(process.argv[2]??join(repo,'apps/desktop/release/mac-arm64/Mochi.app'));
const resources=join(app,'Contents/Resources/mochi'),modules=join(resources,'node_modules'),binary=join(app,'Contents/MacOS/Mochi');
const require=createRequire(import.meta.url),runtime=require(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const root=mkdtempSync(join(tmpdir(),'mochi-reasoning-host-')),requests=[],results=[];let child,log='',cookie,origin,launchUrl,electron;
import {ReplyReader,completedReplies} from '../../../client-plugins/mochi-voice-chat/reply-reader.mjs';
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'本地档位测试回复'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`)});
const redact=text=>text.replace(/token=\S+/g,'token=[redacted]');
async function until(fn,label){const deadline=Date.now()+30000;while(Date.now()<deadline){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,60))}throw Error(label+'\n'+redact(log).slice(-5000))}
async function api(path,body){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const raw=await response.text();assert.ok(response.ok,response.status+raw+'\n'+redact(log).slice(-12000));return JSON.parse(raw)}
async function start(home){log='';child=spawn(binary,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:root,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:modules,DSH_TELEMETRY_DISABLED:'1',NO_COLOR:'1',REASONING_FIXTURE_REF:'loopback-only'},stdio:['ignore','pipe','pipe']});const collect=chunk=>log+=chunk;child.stdout.on('data',collect);child.stderr.on('data',collect);const url=await until(()=>{if(child.exitCode!==null)throw Error(redact(log));return log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u)?.[0]},'Host URL');launchUrl=url;origin=new URL(url).origin;const auth=await fetch(url,{redirect:'manual'});assert.equal(auth.status,303);cookie=auth.headers.getSetCookie().map(x=>x.split(';',1)[0]).join('; ');await api('/api/reasoning-fixture',{action:'ready'})}
async function stop(){if(!child||child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;child=undefined}
try {
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const plugins=join(resources,'plugins'),home=join(root,'teacher');mkdirSync(home);
 runtime.provisionMochiProfiles({homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(resources,'skills'),pluginRoot:plugins,runtimeNodeModulesRoot:modules,role:'teacher'});
 const probe=join(root,'probe');mkdirSync(probe);writeFileSync(join(probe,'package.json'),JSON.stringify({name:'reasoning-fixture',type:'module',main:'index.mjs'}));
 writeFileSync(join(probe,'index.mjs'),`export const inject=['sessionController','connection','workspaceController'];export function apply(ctx){let workspaceId;ctx.connection.fetch.register({path:'/api/reasoning-fixture',methods:['POST'],requestBody:'buffered',fetch:async request=>{try{const x=await request.json();if(x.action==='ready'){workspaceId=(await ctx.workspaceController.create({path:${JSON.stringify(root)}})).workspace.workspaceId;return Response.json({ready:true});}if(x.action==='create')return Response.json(await ctx.sessionController.create({workspaceId,agentPreset:'standard'}));const resolved=await ctx.sessionController.resolveAgent(x.sessionId);if(resolved.error)throw Error(resolved.error.message);const agent=resolved.agent;const count=agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length;await ctx.sessionController.prompt({sessionId:x.sessionId,requestId:'fixture-'+Date.now(),mode:'queue',content:[{type:'text',text:x.text}]},new AbortController().signal);const deadline=Date.now()+15000;while(agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length===count){if(Date.now()>deadline)throw Error('turn timeout');await new Promise(r=>setTimeout(r,30));}return Response.json({events:agent.session.snapshotEvents()});}catch(e){return Response.json({error:String(e.stack)},{status:400})}}})}`);
 const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/reasoning-fixture'));const manifestPath=join(profile,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.dependencies['reasoning-fixture']='link:'+probe;writeFileSync(manifestPath,JSON.stringify(manifest));
 const patch=join(profile,'cordis.patch.yml');writeFileSync(patch,readFileSync(patch,'utf8')+`\n- id: agent-default-model\n  config: {provider: reasoning-fixture, model: capable}\n- id: llm-pi-ai\n  config:\n    providers:\n      reasoning-fixture:\n        api: openai-completions\n        apiKeyEnv: REASONING_FIXTURE_REF\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models: [{id: capable, input: [text], contextWindow: 262144, maxTokens: 4096}]\n- insert:\n    - id: reasoning-fixture\n      name: reasoning-fixture\n`);
 await start(home);const {sessionId}=await api('/api/reasoning-fixture',{action:'create'});
 const first=await api('/api/reasoning-fixture',{sessionId,text:'你好'});
 const rows=events=>events.map(event=>({type:'event',event}));
 assert.equal(completedReplies(rows(first.events),-1).at(-1).text,'本地档位测试回复');
 let snapshot={entries:rows(first.events),change:{kind:'replace'}},listener;const output=[],stops=[];
 const reader=new ReplyReader({speak:request=>{output.push(request.text);return Promise.resolve({ok:true});},stop:request=>{stops.push(request.id);return {ok:true};}});
 reader.bind({eventSource:{getSnapshot:()=>snapshot,subscribe:fn=>{listener=fn;return()=>{listener=null};}}});reader.setEnabled(true);assert.equal(output.length,0);
 const second=await api('/api/reasoning-fixture',{sessionId,text:'再打一次招呼'});snapshot={entries:rows(second.events),change:{kind:'append'}};listener();listener();assert.deepEqual(output,['本地档位测试回复']);reader.close();
 const filtered=second.events.filter(e=>['turn/start','user/message','assistant/message','turn/end'].includes(e.type)).map(e=>({type:e.type,seq:e.seq,turn:e.data.turn,source:e.data.source?.kind,reason:e.data.reason?.kind}));
 const evidence=join(repo,'docs/evidence/harness-upgrade-2026-09-30/voice-header-runtime.json');writeFileSync(evidence,JSON.stringify({passed:true,harness:'0.2.0-rc.2',loopbackOnly:true,gui:false,microphone:false,events:filtered,output,historySilent:true,onceOnly:true},null,2)+'\n');console.log(evidence);
} finally {await stop();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
