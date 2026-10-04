#!/usr/bin/env node
// Actual packaged App owns its Host; deterministic local gateway drives official tools only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{_electron}=require('playwright');
const repo=resolve(import.meta.dirname,'../../..'),appPath=join(repo,'apps/desktop/release/mac-arm64/Mochi.app');
const resources=join(appPath,'Contents/Resources/mochi'),output=join(repo,'docs/evidence/harness-upgrade-2026-09-30/packaged-team');
const root=mkdtempSync(join(tmpdir(),'mochi-packaged-team-')),home=join(root,'home');mkdirSync(home);mkdirSync(output,{recursive:true});
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role:'teacher',resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=Object.fromEntries(['jxl-brand/client.js','jxl-theme/client.js','mochi-modes/modes.mjs','mochi-user-profile/index.mjs'].map(p=>[p,hash(join(resources,'plugins',p))]));
const members=['materials','lesson','assessment'],subjects=['整理教学资料','设计课堂活动','检查评价题目'],requests=[],taskResults=[],errors=[];
const tools=call=>({role:'assistant',tool_calls:call.map((c,index)=>({index,id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))});
function parseTask(value){
 const text=typeof value==='string'?value:JSON.stringify(value);
 try{const parsed=JSON.parse(text);if(parsed.id&&Number.isInteger(parsed.revision))return parsed;for(const v of Object.values(parsed)){if(v&&typeof v==='object'){const t=parseTask(v);if(t)return t}}}catch{}
 const id=text.match(/"id"\s*:\s*"(task-[^"]+)"/),rev=text.match(/"revision"\s*:\s*(\d+)/),status=text.match(/"status"\s*:\s*"([^"]+)"/);
 if(id&&rev)return{id:id[1],revision:Number(rev[1]),status:status?.[1]};return null;
}
const gateway=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),names=(body.tools||[]).map(t=>t.function?.name),texts=body.messages.filter(m=>m.role==='user').map(m=>JSON.stringify(m.content)).join('\n');
 const member=members.find(n=>texts.includes('TEAM_MEMBER_'+n)),lead=texts.includes('TEAM_LEAD_FIXTURE'),final=texts.includes('TEAM_FINAL_LIST');
 const settled=body.messages.filter(m=>m.role==='tool'&&/^pack-team-/.test(m.tool_call_id||''));
 const last=settled.at(-1),lastTask=last?parseTask(last.content):null;
 if(lastTask&&lastTask.status==='completed'&&!taskResults.some(t=>t.id===lastTask.id))taskResults.push({...lastTask,member});
 requests.push({member:member||null,lead,final,tools:names,settled:settled.map(m=>m.tool_call_id),lastTask});
 let delta={role:'assistant',content:member?'已完成本地协作验收 '+member:'本地团队验收完成。'};
 if(lead&&names.includes('spawn_teammate')&&!settled.some(m=>m.tool_call_id==='pack-team-spawn-0'))delta=tools(members.map((name,i)=>({id:'pack-team-spawn-'+i,name:'spawn_teammate',args:{name,description:subjects[i],prompt:'TEAM_MEMBER_'+name+'：为'+subjects[i]+'创建任务、认领、完成；不操作文件或网络。',context:'fresh'}})));
 else if(member&&names.includes('team_task_create')){
  if(!settled.length)delta=tools([{id:'pack-team-'+member+'-create',name:'team_task_create',args:{subject:subjects[members.indexOf(member)],description:'本地固定模型软件验收，无教学准确率声明'}}]);
  else if(last?.tool_call_id.endsWith('-create')){assert.ok(lastTask,'Task create result schema');delta=tools([{id:'pack-team-'+member+'-claim',name:'team_task_update',args:{task_id:lastTask.id,expected_revision:lastTask.revision,action:'claim'}}]);}
  else if(last?.tool_call_id.endsWith('-claim')){assert.ok(lastTask,'Task claim result schema');delta=tools([{id:'pack-team-'+member+'-complete',name:'team_task_update',args:{task_id:lastTask.id,expected_revision:lastTask.revision,action:'complete'}}]);}
 }
 if(lead&&final&&!settled.some(m=>m.tool_call_id==='pack-team-final-list'))delta=tools([{id:'pack-team-final-list',name:'team_task_list',args:{}}]);
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`);
 }catch(e){errors.push('Gateway: '+e.message);res.writeHead(500);res.end('fixture error');}});
await new Promise(done=>gateway.listen(0,'127.0.0.1',done));
writeFileSync(join(home,'settings.yaml'),`agent-default-model:\n  provider: team-fixture\n  model: team-model\nllm-pi-ai:\n  providers:\n    team-fixture:\n      api: openai-completions\n      apiKeyEnv: TEAM_FIXTURE_KEY\n      baseURL: http://127.0.0.1:${gateway.address().port}/v1\n      models:\n        - id: team-model\n          name: Local team fixture\n          input: [text]\n          contextWindow: 262144\n          maxTokens: 4096\n`);
let app,page,passed=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,label)=>{for(let i=0;i<600;i++){const result=await fn();if(result)return result;await sleep(100)}throw Error('Timeout '+label)};
try{
 app=await _electron.launch({executablePath:join(appPath,'Contents/MacOS/Mochi'),args:['--role=teacher','--user-data-dir='+join(root,'browser')],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',TEAM_FIXTURE_KEY:'test-only-never-real'},timeout:60000});
 page=await until(()=>app.windows().find(p=>/^http:\/\/127\.0\.0\.1:/.test(p.url())),'Actual App Host');
 const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged,resources:process.resourcesPath}));assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
 page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);w.setSize(880,840);w.show();w.focus()},page.url());
 await page.getByRole('button',{name:'继续',exact:true}).click();await page.locator('[data-mochi-user-address]').click();await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url).webContents.insertText('团队验收老师'),page.url());
 await page.getByRole('button',{name:'保存称呼',exact:true}).click();await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();
 let completed=false;for(let i=0;i<150;i++){const next=page.getByRole('button',{name:'我了解了，下一步',exact:true}),finish=page.getByRole('button',{name:'完成指引',exact:true});if(await next.isVisible()&&await next.isEnabled())await next.click();else if(await finish.isVisible()&&await finish.isEnabled()){await finish.click();completed=true;break}await sleep(100)}assert.ok(completed,'mandatory guide complete');await page.locator('.mochi-guide').waitFor({state:'hidden'});
 await page.getByText('Local team fixture',{exact:true}).first().waitFor({state:'attached'});
 const send=async text=>{const input=page.locator('[data-composer-input="true"]').filter({visible:true}).last();await input.fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click()};
 await send('TEAM_LEAD_FIXTURE：请使用团队功能创建三位伙伴并完成三个共享任务，仅本地软件验收。');
 await page.locator('.jxl-mochi-team__member').nth(3).waitFor({timeout:60000});
 await until(()=>taskResults.length===3,'three official completed task results');
 await page.waitForFunction(()=>[...document.querySelectorAll('.jxl-mochi-team__member')].every(n=>!n.disabled));
 const firstTools=requests.find(r=>r.lead&&r.tools.includes('spawn_teammate')).tools;
 for(const name of ['write','mochi_call_student','mochi_ppt_create','spawn_teammate'])assert.ok(firstTools.includes(name),'general first turn exposes '+name);
 const measure=()=>[...document.querySelectorAll('.jxl-mochi-team__member')].map(n=>{const r=n.getBoundingClientRect();return{id:n.dataset.mochiMemberId,palette:n.dataset.mochiPetPalette,fill:getComputedStyle(n.querySelector('.expressive-orb__body')).fill,label:n.getAttribute('aria-label'),current:n.getAttribute('aria-current'),x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width}});
 const roster=await page.evaluate(measure);assert.equal(roster.length,4);assert.equal(new Set(roster.map(n=>n.palette)).size,4);assert.equal(new Set(roster.map(n=>n.fill)).size,4);
 for(const r of roster)assert.ok(r.x>=0&&r.right<=880&&r.width>0,'member remains visible within 880px');
 const leadId=roster.find(r=>r.current==='true')?.id;assert.ok(leadId);
 await page.screenshot({path:join(output,'team-lead-880.png')});
 const target=roster.find(r=>r.label.startsWith('lesson，'));assert.ok(target);
 await page.locator(`[data-mochi-member-id="${target.id}"]`).click();await page.locator(`[data-mochi-member-id="${target.id}"][aria-current="true"]`).waitFor();
 const childSession=await page.locator('[data-conversation-content]').getAttribute('data-conversation-session');assert.equal(childSession,target.id);
 const child=await page.evaluate(measure);assert.deepEqual(child.map(r=>[r.id,r.palette]),roster.map(r=>[r.id,r.palette]));await page.screenshot({path:join(output,'team-member-880.png')});
 await page.locator(`[data-mochi-member-id="${leadId}"]`).click();await page.locator(`[data-mochi-member-id="${leadId}"][aria-current="true"]`).waitFor();await send('TEAM_FINAL_LIST：核对共享任务列表的三条已完成结果。');
 await until(()=>requests.some(r=>r.final&&r.settled.includes('pack-team-final-list')),'lead receives official task list');
 assert.deepEqual(errors,[]);for(const [p,h]of Object.entries(hashes))assert.equal(hash(join(resources,'plugins',p)),h);
 const result={passed:true,testedAt:new Date().toISOString(),runtime,resourceSha256:hashes,actualAppCreatesHost:true,localModelFixture:true,paidModel:false,mandatoryGuideComplete:true,generalFirstTurnTools:firstTools,realSpawnTeammateCalls:3,completedTasks:taskResults,roster,child,memberNavigation:true,leadNavigation:true,width:880,errors,requests};writeFileSync(join(output,'team-runtime.json'),JSON.stringify(result,null,2)+'\n');passed=true;console.log(JSON.stringify({passed:true,taskResults,roster,errors}));
}catch(e){if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});writeFileSync(join(output,'failure-body.txt'),await page.locator('body').innerText().catch(()=>''))}writeFileSync(join(output,'failure.json'),JSON.stringify({message:e.message,requests,taskResults,errors},null,2));throw e}
finally{await app?.close();gateway.closeAllConnections();await new Promise(done=>gateway.close(done));if(passed)rmSync(root,{recursive:true,force:true});else console.error('Retained fixture only: '+root)}
