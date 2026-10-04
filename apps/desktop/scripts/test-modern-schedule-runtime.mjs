#!/usr/bin/env node
// Actual official Schedule, durable Session backend, and cold Host restore. No model credentials.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const nodeModules=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Pass isolated candidate node_modules');
const repo=resolve(import.meta.dirname,'../../..'),require=createRequire(import.meta.url);
const runtime=require(join(repo,'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const root=mkdtempSync(join(tmpdir(),'mochi-official-schedule-')),home=join(root,'home'),probe=join(root,'probe'),metadata=join(root,'task.json');
mkdirSync(home);mkdirSync(probe);mkdirSync(join(probe,'node_modules'));symlinkSync(join(nodeModules,'@deepseek-ai'),join(probe,'node_modules/@deepseek-ai'));
runtime.provisionMochiProfiles({homeDir:home,resourceRoot:join(repo,'apps/desktop/resources/mochi-web'),skillsDir:join(repo,'skills'),workspaceRoot:repo,runtimeNodeModulesRoot:nodeModules,role:'teacher'});
writeFileSync(join(probe,'package.json'),JSON.stringify({name:'mochi-schedule-probe',type:'module',main:'index.mjs'}));
writeFileSync(join(probe,'index.mjs'),`import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';
export const inject=['schedule','sessionController','sessions','agents','tools'];
export function apply(ctx){const timer=setTimeout(()=>void(async()=>{try{
const signal=new AbortController().signal;const call=(agent,name,args)=>{const tool=ctx.tools.get(name,agent);assert.ok(tool,name);return tool.execute(args,{agent,signal,callId:'schedule-probe-'+name})};
if(process.env.MOCHI_SCHEDULE_PHASE==='create'){
 const created=await ctx.sessionController.create({cwd:${JSON.stringify(root)},agentPreset:'lesson-planning'});const agent=ctx.agents.get(created.sessionId);
 const schemas=ctx.tools.schemas(agent).map(x=>x.name);for(const n of ['schedule_create','schedule_list','schedule_update','schedule_delete'])assert.ok(schemas.includes(n),n);
 const due=await call(agent,'schedule_create',{title:'隔离短延时提醒',prompt:'这是实际持久化投递验收，不要求调用模型。',after_seconds:8});assert.ok(due.id,JSON.stringify(due));
 const future=await call(agent,'schedule_create',{title:'待修改',prompt:'未来夹具',at:new Date(Date.now()+3600000).toISOString()});assert.ok(future.id);
 const updated=await call(agent,'schedule_update',{id:future.id,title:'修改已保存',prompt:'新版内容'});assert.equal(updated.title,'修改已保存');
 const listed=await call(agent,'schedule_list',{});assert.equal(listed.length,2);
 const catalog=await ctx.schedule.catalog();assert.equal(catalog.length,2);assert.ok(catalog.every(x=>x.sessionId===created.sessionId));
 const deleted=await call(agent,'schedule_delete',{id:future.id});assert.equal(deleted.deleted,true);assert.equal((await ctx.schedule.catalog()).length,1);
 assert.equal(await ctx.sessions.flush(agent.session),true);writeFileSync(${JSON.stringify(metadata)},JSON.stringify({sessionId:created.sessionId,id:due.id,scheduledAt:due.scheduledAt}));
 console.log('MOCHI_SCHEDULE='+JSON.stringify({phase:'create',schemas:schemas.filter(n=>n.startsWith('schedule_')),create:true,catalog:true,update:true,delete:true,sessionFlushed:true}));process.exit(0);
}else{
 const saved=JSON.parse(readFileSync(${JSON.stringify(metadata)},'utf8'));const coldBeforeDue=!ctx.agents.get(saved.sessionId);assert.equal(coldBeforeDue,true,'Session should be cold after Host restart');
 let history;const deadline=Date.now()+20000;do{history=await ctx.schedule.history({...saved,limit:10});if(history.records.length)break;await new Promise(r=>setTimeout(r,100))}while(Date.now()<deadline);
 assert.equal(history.records.length,1,JSON.stringify(history));const receipt=history.records[0];assert.ok(receipt.messageId);assert.ok(receipt.deliveredAt);assert.ok(ctx.agents.get(saved.sessionId),'due delivery restored Agent');
 const catalog=await ctx.schedule.catalog();assert.equal(catalog.length,1);assert.equal(catalog[0].status,'inactive');assert.equal(catalog[0].lastDelivery.messageId,receipt.messageId);
 const list=await ctx.schedule.list({sessionId:saved.sessionId});assert.equal(list.length,0);const deleted=await ctx.schedule.delete(saved);assert.equal(deleted.deleted,true);
 const removed=await ctx.schedule.history({...saved,limit:10});assert.equal(removed.code,'schedule_not_found');
 console.log('MOCHI_SCHEDULE='+JSON.stringify({phase:'restore',coldBeforeDue,restoredAtDue:true,receipt,historyRemovedAfterDelete:true,modelExecutionCompleted:false}));process.exit(0);
}
}catch(e){console.error('MOCHI_SCHEDULE_ERROR='+String(e));process.exit(1)}})(),600);ctx.effect(()=>()=>clearTimeout(timer));}`);
const profile=join(home,'profiles/mochi-web');symlinkSync(probe,join(profile,'node_modules/mochi-schedule-probe'));
const pkg=JSON.parse(readFileSync(join(profile,'package.json'),'utf8'));pkg.dependencies['mochi-schedule-probe']='link:'+probe;writeFileSync(join(profile,'package.json'),JSON.stringify(pkg));
writeFileSync(join(profile,'cordis.patch.yml'),readFileSync(join(profile,'cordis.patch.yml'),'utf8')+'\n- insert:\n    - id: mochi-schedule-probe\n      name: mochi-schedule-probe\n');
async function run(phase){return await new Promise((resolvePromise,reject)=>{const child=spawn(process.execPath,[join(nodeModules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:nodeModules,DSH_TELEMETRY_DISABLED:'1',MOCHI_SCHEDULE_PHASE:phase},stdio:['ignore','pipe','pipe']});let output='';const collect=chunk=>{output=(output+chunk).slice(-16000)};child.stdout.on('data',collect);child.stderr.on('data',collect);const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Schedule test timed out'))},30000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error(output.replace(/token=\S+/g,'token=[redacted]')));const marker=output.split('\n').find(line=>line.startsWith('MOCHI_SCHEDULE='));assert.ok(marker);resolvePromise(JSON.parse(marker.slice('MOCHI_SCHEDULE='.length)))})})}
try{const results=[await run('create'),await run('restore')];console.log(JSON.stringify({passed:true,results},null,2));if(process.argv[3])writeFileSync(resolve(process.argv[3]),JSON.stringify({passed:true,results},null,2)+'\n')}finally{rmSync(root,{recursive:true,force:true})}
