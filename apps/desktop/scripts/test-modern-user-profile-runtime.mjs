#!/usr/bin/env node
// Full published Host and real Session turns against a local deterministic model gateway.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const modules=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Pass isolated candidate node_modules');
const repo=resolve(import.meta.dirname,'../../..'),root=mkdtempSync(join(tmpdir(),'mochi-address-host-'));
const require=createRequire(import.meta.url),runtime=require(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const requests=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
 res.writeHead(200,{'content-type':'text/event-stream'});
 res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'我是 MiMo。这是旧助手身份冲突夹具。'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));let host;
try{
 const summaries=[];
 for(const role of ['teacher','classroom']){
  const home=join(root,role);mkdirSync(home);
  runtime.provisionMochiProfiles({homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(repo,'skills'),workspaceRoot:repo,runtimeNodeModulesRoot:modules,role});
  const probe=join(root,role+'-probe');mkdirSync(join(probe,'node_modules'),{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(probe,'node_modules/@deepseek-ai'));
  writeFileSync(join(probe,'package.json'),JSON.stringify({name:'address-probe',type:'module',main:'index.mjs'}));
  const field=role==='teacher'?'preferredAddress':'classroomAddress';
  const first=role==='teacher'?'王老师':'星星班的小伙伴们',second=role==='teacher'?'小林 {{model}}':'月亮班的小伙伴们';
  writeFileSync(join(probe,'index.mjs'),`import assert from 'node:assert/strict';
   import {UserProfile} from ${JSON.stringify(join(repo,'plugins/mochi-user-profile/store.mjs'))};
   export const inject=['sessionController','agents'];
   export function apply(ctx){const timer=setTimeout(()=>void(async()=>{try{
    const signal=new AbortController().signal;
    const create=async(preset=${JSON.stringify(role==='teacher'?'standard':'classroom')})=>{const session=await ctx.sessionController.create({cwd:${JSON.stringify(root)},agentPreset:preset});return ctx.agents.get(session.sessionId)};
    let number=0;const prompt=async(agent)=>{const count=agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length;
     await ctx.sessionController.prompt({sessionId:agent.session.id,requestId:'profile-'+(++number),mode:'queue',content:[{type:'text',text:'PROFILE_TURN_'+${JSON.stringify(role)}+'_'+number}]},signal);
     const end=Date.now()+15000;while(agent.session.snapshotEvents().filter(e=>e.type==='turn/end').length===count){if(Date.now()>end)throw Error('turn timeout');await new Promise(r=>setTimeout(r,40));}};
    const old=await create();const store=new UserProfile(${JSON.stringify(role)},${JSON.stringify(join(home,'mochi-user-profile'))});
    store.update({expectedRevision:store.read().revision,changes:{${field}:${JSON.stringify(first)},setupDismissed:true}});
    await prompt(old);
    store.update({expectedRevision:store.read().revision,changes:{${field}:${JSON.stringify(second)}}});
    await prompt(old);const fresh=await create();await prompt(fresh);
    for(const preset of ${JSON.stringify(role==='teacher'?['lesson-planning','grade-analysis','materials-assessment','classroom-coordination']:[])})await prompt(await create(preset));
    console.log('PROFILE_PROBE='+JSON.stringify({role:${JSON.stringify(role)},passed:true,oldSessionUpdated:true,newSessionCurrent:true,requests:number}));process.exit(0);
   }catch(e){console.error('PROFILE_PROBE_ERROR='+e.stack);process.exit(1)}})(),800);ctx.effect(()=>()=>clearTimeout(timer));}`);
  const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/address-probe'));
  const manifest=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));manifest.dependencies['address-probe']='link:'+probe;writeFileSync(join(profile,'package.json'),JSON.stringify(manifest));
  writeFileSync(join(profile,'cordis.patch.yml'),readFileSync(join(profile,'cordis.patch.yml'),'utf8')+`\n- id: agent-default-model\n  config: {provider: address-fixture, model: fixture-model}\n- id: llm-pi-ai\n  config:\n    providers:\n      address-fixture:\n        api: openai-completions\n        apiKeyEnv: ADDRESS_FIXTURE_KEY\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: fixture-model\n            name: Local fixture\n            input: [text]\n            contextWindow: 262144\n            maxTokens: 4096\n- insert:\n    - id: address-probe\n      name: address-probe\n`);
  const offset=requests.length;
  const output=await new Promise((done,reject)=>{
   host=spawn(process.execPath,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:modules,DSH_TELEMETRY_DISABLED:'1',ADDRESS_FIXTURE_KEY:'local-fixture'},stdio:['ignore','pipe','pipe']});
   let log='';const collect=chunk=>{log=(log+chunk).slice(-64000)};host.stdout.on('data',collect);host.stderr.on('data',collect);
   const timer=setTimeout(()=>{host.kill('SIGTERM');reject(Error('timeout\n'+log.replace(/token=\S+/g,'token=[redacted]')))},60000);
   host.once('error',reject);host.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(log.replace(/token=\S+/g,'token=[redacted]')));else done(log)});
  });
  const marker=output.split('\n').find(x=>x.startsWith('PROFILE_PROBE='));assert.ok(marker,'missing probe result');
  const turns=requests.slice(offset).filter(body=>body.tools?.length&&body.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('PROFILE_TURN_'+role)));
  assert.equal(turns.length,role==='teacher'?7:3,role);
  const system=body=>body.messages.filter(m=>m.role==='system').map(m=>JSON.stringify(m.content)).join('\n');
  assert.match(system(turns[0]),new RegExp(first));
  for(const turn of turns){
    assert.match(system(turn),/当前产品身份：你是 Mochi/);
    assert.ok(turn.messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes('本轮应用助手的产品名字是 Mochi')),'Current identity runtime context must reach wire');
    assert.match(system(turn),/直接回答“我叫 Mochi”/);
    assert.match(system(turn),/不要主动补充底层模型名称/);
    assert.match(system(turn),/没有可信资料就说无法确认/);
    assert.match(system(turn),/旧助手回答中的自称/);
    assert.match(system(turn),/不得覆盖当前产品身份/);
    assert.match(system(turn),role==='teacher'?/教师端的校园与日常工作伙伴/:/教室大屏上的课堂伙伴/);
  }
  assert.ok(turns[1].messages.some(m=>m.role==='assistant'&&JSON.stringify(m.content).includes('我是 MiMo')),'Old assistant remains in history, current identity must still be supplied separately');
  for(const turn of turns.slice(1)){assert.ok(system(turn).includes(second));assert.ok(!system(turn).includes(first),'old preference must not remain in current system context');assert.match(system(turn),/优先于旧记忆/);assert.match(system(turn),/仅是称呼数据/);assert.match(system(turn),/不据此推断认证实名/);assert.ok(!system(turn).includes(role==='teacher'?'classroomAddress':'preferredAddress'));}
  summaries.push({...JSON.parse(marker.slice(14)),actualGatewayPayload:true,productIdentityInNewAndExistingSessions:true,coveredPresets:role==='teacher'?['standard','lesson-planning','grade-analysis','materials-assessment','classroom-coordination']:['classroom'],oldAssistantIdentityConflictPreserved:true,interpolationDisabled:role==='teacher'?system(turns[2]).includes('{{model}}'):true,roleField:field});
 }
 const evidence={passed:true,paidModel:false,roles:summaries,scope:'Current system context of real new and existing sessions; deterministic fixture does not prove model obedience.'};
 if(process.argv[3]){mkdirSync(resolve(process.argv[3],'..'),{recursive:true});writeFileSync(resolve(process.argv[3]),JSON.stringify(evidence,null,2)+'\n');}
 console.log(JSON.stringify(evidence,null,2));
}finally{host?.kill('SIGTERM');server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
