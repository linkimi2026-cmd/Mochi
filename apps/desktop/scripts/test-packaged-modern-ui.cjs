#!/usr/bin/env node
// Launch the actual packaged application's own main and Host. No development overrides or model calls.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {createRequire}=require('module'),{execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'../../..'),req=createRequire(repo+'/apps/desktop/package.json'),{_electron}=req('playwright');
const appPath=path.resolve(process.argv[2]||''),out=path.resolve(process.argv[3]||repo+'/docs/evidence/harness-upgrade-2026-09-30/packaged-ui-44');
assert.ok(process.argv[2]&&appPath.endsWith('.app'),'Pass the actual Mochi.app');
const binary=appPath+'/Contents/MacOS/Mochi',resources=appPath+'/Contents/Resources',root=fs.realpathSync(fs.mkdtempSync('/tmp/mochi-packaged-ui-'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const packageHashes={appAsar:hash(resources+'/app.asar'),manifest:hash(resources+'/mochi/package-integrity.json'),themeClient:hash(resources+'/mochi/plugins/jxl-theme/client.js')};
const harnessVersion=JSON.parse(fs.readFileSync(resources+'/mochi/node_modules/@deepseek-ai/dsh/package.json','utf8')).version;
assert.equal(harnessVersion,'0.2.0-rc.2');
const results=[],errors=[],gaps=[];fs.mkdirSync(out,{recursive:true});
let passed=false;
function save(){fs.writeFileSync(out+'/checkpoints.json',JSON.stringify({passed,package:appPath,harnessVersion,packageHashes,results,errors,gaps},null,2)+'\n')}
(async()=>{try{
 for(const role of ['teacher','classroom']){
  let app;const home=path.join(root,role),userData=path.join(root,role+'-browser');fs.mkdirSync(home,{recursive:true});
  const env={PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,DSH_TELEMETRY_DISABLED:'1',LANG:process.env.LANG||'en_US.UTF-8'};
  try{
   app=await _electron.launch({executablePath:binary,args:['--role='+role,'--user-data-dir='+userData],env,timeout:60000});
   const versions=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome,packaged:app.isPackaged,appPath:app.getAppPath(),resources:process.resourcesPath,userData:app.getPath('userData')}));
   assert.equal(versions.electron,'44.0.0');assert.equal(versions.packaged,true);assert.equal(versions.appPath,resources+'/app.asar');assert.equal(versions.resources,resources);assert.equal(versions.userData,userData);
   let page;for(let i=0;i<650;i++){
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.hide()});
    page=app.windows().find(p=>/^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));if(page)break;await new Promise(r=>setTimeout(r,100));
   }
   assert.ok(page,'Actual application creates and opens its own Host');
   page.on('pageerror',e=>{errors.push({role,message:e.message});save()});
   await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows()){if(/^http:/.test(w.webContents.getURL())){w.setSize(880,840);w.show();w.focus()}}});
   await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:15000});await page.getByRole('button',{name:'继续',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('jxl-theme-bridge'),null,{polling:100});
   results.push({role,name:'actual-title',title:await page.title()});
   assert.equal(await page.getByText('添加一个 API Key 开始使用',{exact:true}).count(),0);
   const current=await page.evaluate(async()=>await(await fetch('/api/mochi-profile')).json());assert.equal(current.role,role);
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-user-profile')));
   const address=page.locator('[data-mochi-user-address=true]');await address.waitFor();const nickname=role==='teacher'?'包内验收老师':'包内验收班的小伙伴们';
   await page.evaluate(()=>{window.__profileInputEvents=[];for(const type of ['input','change','keydown','keyup','beforeinput'])document.addEventListener(type,e=>{if(e.target.matches?.('[data-mochi-user-address]'))window.__profileInputEvents.push({type:e.type,value:e.target.value,trusted:e.isTrusted})},true)});
   await address.click();
   await app.evaluate(({BrowserWindow},{url,text})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);w.webContents.focus();return w.webContents.insertText(text)},{url:page.url(),text:nickname});
   await address.press('Tab');await page.waitForTimeout(200);
   results.push({role,name:'profile-input-events',domValue:await address.inputValue(),events:await page.evaluate(()=>window.__profileInputEvents)});save();
   const [saved]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/mochi-profile')&&r.request().method()==='PATCH'),page.getByRole('button',{name:'保存称呼',exact:true}).click()]);
   const savedProfile=await saved.json();results.push({role,name:'profile-ui-save',request:JSON.parse(saved.request().postData()),response:savedProfile});save();assert.equal(role==='teacher'?savedProfile.preferredAddress:savedProfile.classroomAddress,nickname,'UI saves the actual typed preference');
   const checkpoint=async(name,selector)=>{
    const n=page.locator(selector).filter({visible:true}).first();await n.waitFor();await page.waitForTimeout(450);
    const geometry=await n.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,backgroundImage:s.backgroundImage,background:s.backgroundColor,shadow:s.boxShadow}});
    assert.equal(geometry.clientWidth,geometry.scrollWidth,name+' no horizontal overflow');
    if(!geometry.backgroundImage.includes('radial-gradient'))gaps.push({role,name,reason:'packaged theme lacks the final paper-edge decoration'});
    await page.screenshot({path:out+'/'+role+'-'+name+'.png',timeout:5000});results.push({role,name,selector,versions,geometry});save();console.log(role+': '+name);
   };
   await checkpoint('identity','.mochi-lan-panel');await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();
   for(let i=0;i<20;i++){const next=page.getByRole('button',{name:'我了解了，下一步',exact:true}),finish=page.getByRole('button',{name:'完成指引',exact:true});if(await next.isVisible()){await next.click();await page.waitForTimeout(250)}else if(await finish.isVisible()){await finish.click();break}else await page.waitForTimeout(150)}
   await page.reload();await page.waitForFunction(()=>document.getElementById('jxl-theme-bridge'),null,{polling:100});
   const after=await page.evaluate(async()=>await(await fetch('/api/mochi-profile')).json());assert.equal(after.role,role);assert.equal(role==='teacher'?after.preferredAddress:after.classroomAddress,nickname);
   await checkpoint('conversation','[data-conversation-content]');await checkpoint('composer','[data-composer-card]');
   const preload=await page.evaluate(()=>({lan:!!window.mochiLanDesktop,classroom:!!window.mochiClassroomDesktop,voiceChat:!!window.mochiVoiceChatDesktop,rail:!!window.mochiRailDesktop}));assert.ok(Object.values(preload).every(Boolean),'actual packaged preload bridges');results.push({role,name:'actual-preload',preload});
   if(role==='teacher'){
    const preset=page.getByRole('button',{name:'通用',exact:true});assert.ok(await preset.isVisible(),'new teacher defaults to general mode');await preset.click();const modeText=await page.locator('body').innerText();for(const id of ['备课与课件','资料与试卷','成绩分析','班级与教室'])assert.ok(modeText.includes(id),'specialized '+id+' remains visible');await page.keyboard.press('Escape');
   }
   if(role==='teacher'){assert.ok(await page.getByRole('button',{name:'工作',exact:true}).isVisible());assert.ok(await page.getByRole('button',{name:'对话',exact:true}).isVisible())}
   else results.push({role,name:'existing-role-composition',preset:'教室助手',chatWorkToggle:false,reason:'classroom profile excludes mochi-modes and teacher presets'});
   await page.getByRole('button',{name:'查看记忆',exact:true}).click();await checkpoint('memory','.mochi-memory-panel');for(const name of ['日记','历史','偏好与观察'])assert.ok(await page.locator('.mochi-memory-panel').getByRole('tab',{name,exact:true}).isVisible());await page.locator('.mochi-memory-panel').getByRole('button',{name:'关闭',exact:true}).click();
   if(role==='classroom'){
    await page.getByRole('button',{name:'课堂管家',exact:true}).click();await checkpoint('timetable','.mochi-planner');await page.getByRole('button',{name:'关闭课堂日历',exact:true}).click();
    await page.locator('button[data-mochi-classroom-status]').click();await checkpoint('classroom-assistant','.mochi-classroom-panel');await page.locator('.mochi-classroom-panel').getByRole('button',{name:'关闭',exact:true}).click();
   }
   await page.getByRole('button',{name:'设置',exact:true}).click();await checkpoint('settings','[role="dialog"]:has(> nav) > [class*="_content"]');assert.ok(await page.getByRole('button',{name:'模型',exact:true}).isVisible());await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'插件',exact:true}).click();await checkpoint('plugins','[data-plugin-panel]');
   for(const name of ['智能体团队','自动授权审查','自动化任务','语音输入','终端','Agent 循环','子智能体','网页搜索']){await page.getByRole('button',{name:'查看 '+name,exact:true}).click();await checkpoint('plugin-'+name,'[data-plugin-panel]');await page.getByText('插件列表',{exact:true}).click()}
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-onboarding')));await checkpoint('guide','.mochi-guide');const closeGuide=page.getByRole('button',{name:'关闭重看指引',exact:true});if(await closeGuide.isVisible())await closeGuide.click();
   await page.getByRole('button',{name:'自动化任务',exact:true}).click();await checkpoint('automation-tasks','[data-testid="task-manager-page"]');
   const children=execFileSync('ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n').filter(s=>Number(s.trim().split(/\s+/)[1])===app.process().pid&&s.includes(resources+'/mochi/node_modules/@deepseek-ai/dsh/lib/bin.js')).map(s=>s.replace(/token=\S+/g,'token=[redacted]'));
   assert.ok(children.length,'Host process is a direct child of the real App');results.push({role,name:'actual-app-host-child',appPid:app.process().pid,hostChildren:children,sourceOverrides:false,noModelCalls:true,addressReloaded:true});save();console.log(role+' packaged UI complete');
  }catch(error){
   for(const [index,p] of (app?.windows()||[]).entries()){
    if(!/^http:/.test(p.url()))continue;
    await p.screenshot({path:out+'/'+role+'-failure-'+index+'.png',timeout:3000}).catch(()=>{});
    fs.writeFileSync(out+'/'+role+'-failure-'+index+'.txt',await p.locator('body').innerText().catch(()=>''));
    fs.writeFileSync(out+'/'+role+'-failure-'+index+'.json',JSON.stringify(await p.evaluate(async()=>({url:location.href,title:document.title,themeBridge:!!document.getElementById('jxl-theme-bridge'),profile:await(await fetch('/api/mochi-profile')).json(),input:document.querySelector('[data-mochi-user-address]')?.value,dataset:{...document.documentElement.dataset}})).catch(()=>({})),null,2));
   }
   throw error;
  }finally{await app?.close()}
 }
 assert.deepEqual(errors,[]);assert.equal(hash(resources+'/app.asar'),packageHashes.appAsar,'App unchanged while testing');assert.equal(hash(resources+'/mochi/package-integrity.json'),packageHashes.manifest);passed=true;save();console.log(JSON.stringify({passed,packageHashes,count:results.length,gaps,errors}));
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{save();console.error(String(e.message).replace(/token=\S+/g,'token=[redacted]'));process.exitCode=1});
