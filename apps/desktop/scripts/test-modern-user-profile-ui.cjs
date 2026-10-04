#!/usr/bin/env node
// Real authenticated candidate page; local role labels are not a campus login.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const repo=path.resolve(__dirname,'../../..'),req=createRequire(path.join(repo,'apps/desktop/package.json'));
const {_electron}=req('playwright'),evidence=path.join(repo,'docs/evidence/harness-upgrade-2026-09-30');
(async()=>{const root=fs.mkdtempSync('/tmp/mochi-profile-ui-');let app;
try{
 const log=fs.readFileSync(process.argv[2]||'/tmp/mochi-harness-020-probe/teacher-high.log','utf8');const url=log.match(/http:\/\/127\.0\.0\.1:19877\/\?token=\S+/)?.[0];assert.ok(url,'Teacher candidate Host not ready');
 fs.writeFileSync(path.join(root,'main.cjs'),`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:true,width:880,height:900}).loadURL('about:blank'));`);
 app=await _electron.launch({executablePath:req('electron'),args:[path.join(root,'main.cjs'),`--user-data-dir=${root}/profile`]});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForTimeout(1800);
 for(const name of ['继续','稍后配置']){const button=page.getByRole('button',{name,exact:true});if(await button.count())await button.click();}
 const original=await page.evaluate(async()=>await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json());assert.equal(original.role,'teacher');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-user-profile')));const card=page.getByRole('region',{name:'称呼与基本信息'});await card.waitFor();
 const input=card.locator('[data-mochi-user-address=true]');await input.fill('UI验收称呼');await card.getByRole('button',{name:'保存称呼',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.mochiUserProfileReady==='true');
 await page.evaluate(async()=>{const p=await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json();const r=await fetch('/api/mochi-profile',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:p.revision,changes:{preferredAddress:'另页称呼'}})});if(!r.ok)throw Error('External profile fixture failed')});
 await input.fill('旧页不能覆盖');await card.getByRole('button',{name:'保存称呼',exact:true}).click();await card.getByRole('button',{name:'读取最新称呼',exact:true}).waitFor();
 assert.equal((await page.evaluate(async()=>await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json())).preferredAddress,'另页称呼');
 await card.getByRole('button',{name:'读取最新称呼',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-mochi-user-address=true]')?.value==='另页称呼');
 const priorIdentity=await page.evaluate(async()=>await(await fetch('/api/mochi-lan/state',{credentials:'same-origin'})).json());
 await card.locator('summary').click();await card.getByLabel('学校',{exact:true}).fill('离线验收学校');await card.getByLabel('设备显示名称',{exact:true}).fill('独立教师验收电脑');await card.getByRole('button',{name:'保存本机身份',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await(await fetch('/api/mochi-lan/state',{credentials:'same-origin'})).json();return s.identity?.schoolId==='离线验收学校'&&s.identity?.displayName==='独立教师验收电脑'});
 await page.reload();await page.waitForTimeout(1400);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-user-profile')));await card.waitFor();
 const state=await page.evaluate(async()=>await(await fetch('/api/mochi-lan/state',{credentials:'same-origin'})).json());assert.equal(state.identity.role,'teacher');assert.equal(state.identity.schoolId,'离线验收学校');assert.equal(state.identity.displayName,'独立教师验收电脑');assert.equal(await input.inputValue(),'另页称呼');
 const authStatus=await card.locator('[data-mochi-campus-auth]').getAttribute('data-mochi-campus-auth');assert.equal(authStatus,'unknown','Isolated fixture has no verified campus session');
 await card.locator('summary').click();const geometry=await page.getByRole('dialog',{name:'设备与连接',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,pageWidth:document.documentElement.scrollWidth,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}});assert.equal(geometry.pageWidth,880);assert.equal(geometry.scrollWidth,geometry.clientWidth);
 fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'teacher-modern-profile-identity.png')});
 await page.evaluate(async preferredAddress=>{const current=await(await fetch('/api/mochi-profile',{credentials:'same-origin'})).json();const response=await fetch('/api/mochi-profile',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:current.revision,changes:{preferredAddress,setupDismissed:true}})});if(!response.ok)throw Error('Profile cleanup failed')},original.preferredAddress);
 if(priorIdentity.identity)await page.evaluate(async identity=>{const response=await fetch('/api/mochi-lan/identity',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({identity:{schoolId:identity.schoolId,displayName:identity.displayName}})});if(!response.ok)throw Error('Identity restoration failed')},priorIdentity.identity);
 assert.deepEqual(errors,[]);const result={passed:true,realElectronUI:true,role:'teacher',nicknamePersisted:true,concurrentEditRejected:true,explicitReloadRecovered:true,localIdentityPersisted:true,campusAuthStatus:authStatus,campusLoginVerified:false,geometry,errors,fixtureLocalIdentityRetained:!priorIdentity.identity};fs.writeFileSync(path.join(evidence,'user-profile-ui.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await app?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(String(e.message).replace(/token=\S+/g,'token=[redacted]'));process.exitCode=1});
