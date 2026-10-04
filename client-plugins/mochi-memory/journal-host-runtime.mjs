// Real Harness, SQLite journal routes and Electron; test-only records, no paid model.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,cpSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {JournalStore,journalDate} from '../../plugins/mochi-memory/journal-store.mjs';
import {openStore,defaultDbPath} from '../../plugins/mochi-memory/mem-store.mjs';
const modules=resolve(process.argv[2]||'/tmp/mochi-harness-020-probe/node_modules');
const repo=resolve(import.meta.dirname,'../..'),req=createRequire(join(repo,'apps/desktop/package.json')),{_electron}=req('playwright');
const role=process.env.MOCHI_JOURNAL_ROLE||'teacher',root=mkdtempSync(join(tmpdir(),'mochi-journal-ui-')),home=join(root,'home'),profile=join(home,'profiles/web');
const evidence=resolve(process.env.MOCHI_JOURNAL_EVIDENCE_DIR||join(repo,'docs/evidence/harness-upgrade-2026-09-30/journal-ui',role));
let host,electron,log='';const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,label){const end=Date.now()+45000;while(Date.now()<end){const value=await read();if(value)return value;await sleep(100)}throw Error(label+'\n'+log.replace(/token=\S+/g,'token=[redacted]').slice(-3000))}
try{
 mkdirSync(join(profile,'node_modules'),{recursive:true});mkdirSync(evidence,{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'));
 const plugins=[['mochi-task-scheduler','plugins/mochi-task-scheduler'],['mochi-memory','plugins/mochi-memory'],['mochi-memory-client','client-plugins/mochi-memory'],['jxl-brand','client-plugins/jxl-brand'],['jxl-theme','client-plugins/jxl-theme']],dependencies={};
 for(const[name,source]of plugins){const target=join(root,name);cpSync(join(repo,source),target,{recursive:true,filter:path=>!basename(path).startsWith('node_modules')});mkdirSync(join(target,'node_modules'),{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(target,'node_modules/@deepseek-ai'));symlinkSync(target,join(profile,'node_modules',name));dependencies[name]='link:'+target}
 writeFileSync(join(profile,'package.json'),JSON.stringify({name:'journal-ui-test',private:true,dependencies,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));writeFileSync(join(profile,'cordis.yml'),'[]\n');
 writeFileSync(join(profile,'cordis.patch.yml'),`- id: ui-settings-models\n  config: {credentialOnboarding: false}\n- id: ui-brand-official\n  disabled: true\n- insert:\n    - id: mochi-memory\n      name: mochi-memory\n      config: {role: ${role}}\n    - id: mochi-memory-client\n      name: mochi-memory-client\n    - id: jxl-brand\n      name: jxl-brand\n    - id: jxl-theme\n      name: jxl-theme\n`);
 const now=Date.now(),today=journalDate(now),yesterday=journalDate(now-86400000),db=openStore(defaultDbPath(home));
 try{
  const journal=new JournalStore(db,{role});journal.configure({expectedRevision:0,autoEnabled:false});
  for(let i=0;i<4;i++)journal.recordActivity({id:'ui-test-today-'+i,kind:'conversation',at:now-i*1000,summary:'界面测试夹具，并非真实课堂：一起讨论植物怎样获取养分。'.repeat(25),sourceIds:['fixture-'+i]});
  journal.generateDay(today);journal.recordActivity({id:'ui-test-yesterday',kind:'classroom',at:now-86400000,summary:'界面测试夹具，并非真实课堂：昨天记录了观察问题。',sourceIds:['fixture-yesterday']});
  journal.saveGeneratedDay({date:yesterday,body:'这封信来自测试夹具，用于验证模型整理标签，不是真实课堂内容。',title:'模型日记标签验收',sourceIds:['ui-test-yesterday']});
 }finally{db.close()}
 host=spawn(process.execPath,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','web','--port','0','--no-open'],{cwd:root,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',NODE_PATH:modules,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 const collect=chunk=>{log=(log+chunk).slice(-45000)};host.stdout.on('data',collect);host.stderr.on('data',collect);
 const url=await until(()=>log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0],'Host URL');
 const main=join(root,'main.cjs');writeFileSync(main,`const{app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('lang','zh-CN');app.whenReady().then(()=>new BrowserWindow({width:1200,height:900,show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}}).loadURL(${JSON.stringify(url)}));`);
 electron=await _electron.launch({executablePath:req('electron'),args:[main,'--user-data-dir='+join(root,'electron')]});
 const page=await electron.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState();
 const welcome=page.getByRole('button',{name:'继续',exact:true});await welcome.waitFor();await welcome.click();
 await page.getByRole('button',{name:'查看记忆',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Mochi 记住了什么',exact:true});await panel.waitFor();
 const diary=panel.locator('#mochi-memory-diary'),history=panel.locator('#mochi-memory-history');
 await diary.locator('.mochi-journal-envelope').first().waitFor();assert.equal(await diary.locator('.mochi-journal-envelope').count(),2);
 assert.match(await diary.innerText(),/本机活动摘录/);assert.match(await diary.innerText(),/由模型依据活动整理/);
 await page.screenshot({path:join(evidence,'diary-envelopes.png')});
 const entryFor=day=>diary.getByRole('button',{name:new RegExp('打开 '+day+' 的日记')});
 await entryFor(today).click();await diary.getByRole('button',{name:'编辑这封信',exact:true}).waitFor();
 assert.ok((await diary.locator('.mochi-journal-body').innerText()).length>2000,'full long diary, not excerpt');
 await diary.getByRole('button',{name:'编辑这封信',exact:true}).click();
 const editedBody='人工更正的界面验收长信，非真实课堂。\n\n'+('请保留每一段文字与换行。\n'.repeat(350));
 await diary.getByRole('textbox',{name:'日记标题',exact:true}).fill('植物小信（界面验收）');await diary.getByRole('textbox',{name:'日记长正文',exact:true}).fill(editedBody);
 await diary.getByRole('button',{name:'保存这封日记',exact:true}).click();await panel.getByText('这封日记已保存。',{exact:true}).waitFor();
 const fetchJson=(path,data)=>page.evaluate(async({path,data})=>{const r=await fetch('/api/mochi-memory/journal'+path,{credentials:'same-origin',...(data?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json()}},{path,data});
 const saved=await fetchJson('/entry?id='+encodeURIComponent('diary:'+today));assert.equal(saved.data.body,editedBody);assert.equal(saved.data.edited,true);
 await diary.getByRole('button',{name:'查看这封信的旧版本',exact:true}).click();await diary.locator('.mochi-journal-versions details').waitFor();
 await page.screenshot({path:join(evidence,'diary-long-letter.png')});
 await diary.getByRole('button',{name:'编辑这封信',exact:true}).click();await diary.getByRole('textbox',{name:'日记长正文',exact:true}).fill('保留这份未保存草稿。');
 await fetchJson('/edit',{id:saved.data.id,expectedRevision:saved.data.revision,title:'另一页已保存的新信名'});
 await diary.getByRole('button',{name:'保存这封日记',exact:true}).click();await panel.getByRole('alert').waitFor();
 assert.match(await panel.getByRole('alert').innerText(),/内容已变化/);assert.equal(await diary.getByRole('textbox',{name:'日记长正文',exact:true}).inputValue(),'保留这份未保存草稿。');
 await diary.getByRole('button',{name:'放弃这次修改',exact:true}).click();await diary.getByRole('button',{name:'返回日期信封',exact:true}).click();
 await diary.locator('input[aria-label="整理日记日期"]').fill('2020-01-01');await diary.getByRole('button',{name:'整理这一天',exact:true}).click();await panel.getByText('这一天没有已保存活动，没有编写日记。',{exact:true}).waitFor();assert.equal(await diary.locator('.mochi-journal-envelope').count(),2);
 await diary.locator('input[aria-label="整理日记日期"]').fill(today);await diary.getByRole('button',{name:'整理这一天',exact:true}).click();await panel.getByText(/人工修改的日记会保留/).waitFor();assert.equal((await fetchJson('/entry?id='+encodeURIComponent(saved.data.id))).data.body,editedBody);
 await panel.getByRole('tab',{name:'历史',exact:true}).click();
 await history.getByRole('button',{name:'编辑历史名称与长正文',exact:true}).click();await history.getByRole('textbox',{name:'历史名称',exact:true}).fill('我们的相处册（界面验收）');
 const historyBody='这是用户手动编写的界面测试历史。\n'.repeat(300);await history.getByRole('textbox',{name:'历史长正文',exact:true}).fill(historyBody);await history.getByRole('button',{name:'保存这本历史',exact:true}).click();await panel.getByText('这本历史已保存。',{exact:true}).waitFor();
 let snapshot=(await fetchJson('/state')).data;assert.equal(snapshot.history.title,'我们的相处册（界面验收）');assert.equal(snapshot.history.body,historyBody);
 await history.locator('input[aria-label="历史开始日期"]').fill(yesterday);await history.locator('input[aria-label="历史结束日期"]').fill(today);await history.getByRole('button',{name:'预览这段历史',exact:true}).click();
 await history.getByRole('textbox',{name:'历史总结预览',exact:true}).waitFor();assert.equal((await fetchJson('/state')).data.history.body,historyBody,'preview does not save');
 assert.match(await history.innerText(),/不等同模型概括/);
 await history.getByRole('textbox',{name:'历史总结预览',exact:true}).fill('亲自检查过的历史预览。\n'+(await history.getByRole('textbox',{name:'历史总结预览',exact:true}).inputValue()));
 await page.screenshot({path:join(evidence,'history-preview.png')});
 await history.getByRole('button',{name:'用预览替换这本历史',exact:true}).click();await panel.getByText(/已把检查过的预览保存为历史/).waitFor();
 snapshot=(await fetchJson('/state')).data;assert.match(snapshot.history.body,/亲自检查过/);assert.equal(snapshot.history.sourceEntryIds.length,2);assert.equal(snapshot.history.edited,true);
 await panel.getByRole('tab',{name:'日记',exact:true}).click();await diary.getByText('日记本名称与每日整理',{exact:true}).click();await diary.getByRole('button',{name:'修改日记设置',exact:true}).click();
 await diary.getByRole('textbox',{name:'日记本名称',exact:true}).fill('Mochi 给我的信');await diary.locator('input[aria-label="每日整理时间"]').fill('23:59');await diary.getByRole('checkbox',{name:'自动整理',exact:true}).check();await diary.getByRole('button',{name:'保存日记设置',exact:true}).click();await panel.getByText(/日记设置已保存/).waitFor();
 snapshot=(await fetchJson('/state')).data;assert.equal(snapshot.settings.diaryName,'Mochi 给我的信');assert.equal(snapshot.settings.autoEnabled,true);assert.equal(snapshot.scheduling.task.state,'scheduled');assert.match(await diary.innerText(),/下次整理/);
 await panel.getByRole('tab',{name:'偏好与观察',exact:true}).click();await panel.getByRole('button',{name:'记住一件事',exact:true}).click();await panel.getByRole('textbox',{name:'记忆内容',exact:true}).fill('界面验收偏好：喜欢清晰的课堂说明。');await panel.getByRole('button',{name:'保存记忆',exact:true}).click();await panel.getByText('界面验收偏好：喜欢清晰的课堂说明。',{exact:true}).waitFor();await panel.getByRole('button',{name:'固定',exact:true}).click();await panel.getByRole('button',{name:'取消固定',exact:true}).waitFor();
 await panel.getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.getByRole('button',{name:'查看记忆',exact:true}).click();await panel.waitFor();await diary.getByRole('heading',{name:'Mochi 给我的信',exact:true}).waitFor();
 await panel.getByRole('tab',{name:'历史',exact:true}).click();await history.getByRole('heading',{name:'我们的相处册（界面验收）',exact:true}).waitFor();assert.match(await history.innerText(),/亲自检查过/);
 await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(700,800));await page.screenshot({path:join(evidence,'history-narrow.png')});
 const geometry=await panel.evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,bodyMaxLength:document.querySelector('#mochi-memory-history textarea[aria-label="历史长正文"]')?.maxLength}));assert.ok(geometry.scrollWidth<=geometry.width+1,'no horizontal overflow');assert.deepEqual(errors,[]);
 const electronVersion=await electron.evaluate(()=>process.versions.electron);
 const result={role,electronVersion,nodeHostVersion:process.version,harness:'0.2.0-rc.2',testFixtureContent:true,paidModel:false,actualAuthenticatedJournalRoutes:true,dateEnvelopes:2,longDiaryCharacters:editedBody.length,longHistoryCharacters:historyBody.length,diaryTitleAndBodySaved:true,revisionConflictRetainsDraft:true,manualEditProtected:true,emptyDayNotInvented:true,previewDoesNotSave:true,explicitPreviewSave:true,sourceEntries:2,actualScheduling:true,preferencesCrudRetained:true,reloadPersists:true,geometry,errors};writeFileSync(join(evidence,'journal-ui-runtime.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){if(electron){const page=await electron.firstWindow();await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-5000))}console.error(log.replace(/token=\S+/g,'token=[redacted]').slice(-3000));throw error}
finally{await electron?.close();if(host&&host.exitCode===null){host.kill('SIGTERM');await Promise.race([new Promise(done=>host.once('exit',done)),sleep(5000)])}rmSync(root,{recursive:true,force:true})}
