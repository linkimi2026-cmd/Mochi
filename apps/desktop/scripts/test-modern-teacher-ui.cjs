#!/usr/bin/env node
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..');const evidence=path.join(repo,'docs/evidence/harness-upgrade-2026-09-30');fs.mkdirSync(evidence,{recursive:true});
const {createRequire}=require('module');const req=createRequire(path.join(repo,'apps/desktop/package.json'));
const {_electron}=req('playwright');
(async()=>{const root=fs.mkdtempSync('/tmp/mochi-teacher-ui-high-');let app;
try{
 const log=fs.readFileSync(process.argv[2]||'/tmp/mochi-harness-020-probe/teacher-high.log','utf8');const url=log.match(/http:\/\/127\.0\.0\.1:19877\/\?token=\S+/)?.[0];if(!url)throw Error('Host not ready');
 const main=path.join(root,'main.cjs');fs.writeFileSync(main,`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:true,width:1280,height:900}).loadURL("about:blank"));`);
 app=await _electron.launch({executablePath:req('electron'),args:[main,`--user-data-dir=${root}/profile`]});
 const page=await app.firstWindow();const errors=[];const failures=[];page.on('response',r=>{if(r.status()>=400)failures.push({status:r.status(),path:new URL(r.url()).pathname})});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.goto(url);await page.waitForLoadState();await page.waitForTimeout(1800);
 async function skipOnboarding(){for(const name of ['继续','稍后配置']){const b=page.getByRole('button',{name,exact:true});if(await b.count()){await b.click();await page.waitForTimeout(400)}}}
 await skipOnboarding();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-user-profile')));
 const addressInput=page.locator('[data-mochi-user-address=true]');await addressInput.waitFor();await addressInput.fill('验收老师');await page.getByRole('button',{name:'保存称呼',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.mochiUserProfileReady==='true');await page.screenshot({path:path.join(evidence,'teacher-modern-profile-first-use.png')});await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();
 const workspace=page.getByRole('button',{name:'选择工作区',exact:true});if(await workspace.count()){await workspace.click();await page.getByRole('menuitem',{name:'默认工作区',exact:true}).click();await page.waitForTimeout(500)}
 const checkpoints=[];
 async function snapshot(name){await page.screenshot({path:path.join(evidence,'teacher-modern-'+name+'.png')});checkpoints.push({name,title:await page.title(),body:(await page.locator('body').innerText()).slice(0,5000),buttons:await page.getByRole('button').evaluateAll(ns=>ns.map(n=>({label:n.getAttribute('aria-label'),text:n.textContent})))});fs.writeFileSync(path.join(evidence,'teacher-ui-checkpoints.json'),JSON.stringify({checkpoints,errors,failures},null,2))}
 await snapshot('home');
 await page.getByRole('button',{name:'工作',exact:true}).click();await page.waitForTimeout(700);await snapshot('work-session');
 await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();await page.waitForTimeout(600);await snapshot('sidebar');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(880,900));await page.waitForTimeout(500);
 const measure=()=>{const input=document.querySelector('textarea,[contenteditable=true]');const ancestry=[];for(let n=input;n&&ancestry.length<7;n=n.parentElement){const r=n.getBoundingClientRect();ancestry.push({tag:n.tagName,class:n.className,x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth})}return{viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},inputAncestry:ancestry,buttons:[...document.querySelectorAll('button')].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&r.y>innerHeight-350&&r.y<innerHeight}).map(n=>{const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:n.getAttribute('aria-label'),text:n.textContent,class:n.className,x:r.x,y:r.y,width:r.width,height:r.height,inViewport:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,centerClickable:n===hit||n.contains(hit)}})}};
 const narrowGeometry=await page.evaluate(measure);
 await snapshot('narrow-sidebar');
 const voiceChat=page.getByRole('button',{name:'开启语音对话',exact:true});const voiceChatOnBlank=await voiceChat.count();
 if(!voiceChatOnBlank){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));await page.waitForTimeout(300);const prior=page.getByText('新会话',{exact:true}).last();if(await prior.count())await prior.click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(880,900));await page.waitForTimeout(500)}
 const voiceChatOnSession=await voiceChat.count();if(voiceChatOnSession)assert.equal(await voiceChat.getAttribute('aria-pressed'),'false');
 const narrowSessionGeometry=await page.evaluate(measure);await snapshot('narrow-session');
 await page.getByRole('button',{name:/^小信箱，/}).click();await page.getByRole('dialog',{name:'设备与连接',exact:true}).waitFor();await snapshot('lan-first-use');await page.keyboard.press('Escape');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));await page.waitForTimeout(300);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForTimeout(500);await snapshot('settings-campus');
 await page.getByRole('button',{name:'奶油米白',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.mochiPetPalette==='cream');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mochiPetPalette==='cream');await page.waitForTimeout(1000);assert.equal(await page.getByText('添加一个 API Key 开始使用',{exact:true}).count(),0);await skipOnboarding();if(!(await page.getByRole('button',{name:'奶油米白',exact:true}).isVisible()))await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForTimeout(500);
 const profileAfterReload=await page.evaluate(async()=>await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json());assert.equal(profileAfterReload.preferredAddress,'验收老师');
 assert.equal(await page.getByRole('button',{name:'奶油米白',exact:true}).getAttribute('aria-pressed'),'true');await snapshot('settings-cream-reloaded');
 await page.getByRole('button',{name:'经典焦糖',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.mochiPetPalette==='caramel');
 await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.mochiPetPalette==='caramel');await page.waitForTimeout(1000);assert.equal(await page.getByText('添加一个 API Key 开始使用',{exact:true}).count(),0);await skipOnboarding();if(!(await page.getByRole('button',{name:'经典焦糖',exact:true}).isVisible()))await page.getByRole('button',{name:'设置',exact:true}).click();await page.waitForTimeout(500);
 assert.equal(await page.getByRole('button',{name:'经典焦糖',exact:true}).getAttribute('aria-pressed'),'true');await snapshot('settings-caramel-restored');
 await page.keyboard.press('Escape');await page.waitForTimeout(200);
 await page.getByRole('button',{name:'插件',exact:true}).click();await page.waitForTimeout(700);await snapshot('plugins');
 assert.ok(checkpoints.find(x=>x.name==='home').body.includes('你好，我是 Mochi'));
 assert.ok(checkpoints.find(x=>x.name==='settings-campus').body.includes('登录校园账号'));
 for(const title of ['智能体团队','自动授权审查','自动化任务','语音输入','终端','Agent 循环','子智能体','网页搜索'])assert.ok(checkpoints.find(x=>x.name==='plugins').body.includes(title),title);
 assert.equal(errors.some(x=>!x.includes('Failed to load resource')),false);
 await page.evaluate(async()=>{const current=await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json();const result=await fetch('/api/mochi-profile',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:current.revision,changes:{preferredAddress:'',setupDismissed:true}})});if(!result.ok)throw Error('Test profile cleanup failed')});
 fs.writeFileSync(path.join(evidence,'teacher-ui-checkpoints.json'),JSON.stringify({checkpoints,narrowGeometry,narrowSessionGeometry,userAddressPersistence:{saved:true,reloaded:true,clearedAfterTest:true},palettePersistence:{creamReloaded:true,caramelRestored:true},voiceChat:{blankEntryPresent:!!voiceChatOnBlank,sessionEntryPresent:!!voiceChatOnSession,initiallyEnabled:voiceChatOnSession?false:null},credentialOnboardingDisabled:true,errors,failures},null,2));
 console.log(JSON.stringify({passed:true,checkpoints:checkpoints.map(x=>x.name),narrowGeometry,errors,failures}));


}finally{await app?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(String(e.message).replace(/token=\S+/g,'token=[redacted]'));process.exitCode=1});
