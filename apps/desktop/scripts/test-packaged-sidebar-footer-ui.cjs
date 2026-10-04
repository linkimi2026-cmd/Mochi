#!/usr/bin/env node
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto'),{createRequire}=require('module');
const repo=path.resolve(__dirname,'../../..'),req=createRequire(repo+'/apps/desktop/package.json'),{_electron}=req('playwright');
const appPath=repo+'/apps/desktop/release/mac-arm64/Mochi.app',resources=appPath+'/Contents/Resources',output=repo+'/docs/evidence/harness-upgrade-2026-09-30/packaged-sidebar-footer';
const root=fs.realpathSync(fs.mkdtempSync('/tmp/mochi-packaged-footer-')),results=[],errors=[];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clientHashes=Object.fromEntries(['mochi-memory-client','mochi-classroom-planner-client','mochi-onboarding','jxl-theme','mochi-classroom-assistant-client','mochi-voice-chat'].map(p=>[p,hash(resources+'/mochi/plugins/'+p+'/client.js')]));
for(const [name,folder] of [['mochi-memory-client','mochi-memory'],['mochi-classroom-planner-client','mochi-classroom-planner'],['mochi-onboarding','mochi-onboarding'],['jxl-theme','jxl-theme'],['mochi-classroom-assistant-client','mochi-classroom-assistant'],['mochi-voice-chat','mochi-voice-chat']])assert.equal(clientHashes[name],hash(repo+'/client-plugins/'+folder+'/client.js'));
fs.mkdirSync(output,{recursive:true});
const save=passed=>fs.writeFileSync(output+'/checkpoints.json',JSON.stringify({passed,appPath,clientHashes,results,errors},null,2)+'\n');
(async()=>{try{for(const role of ['teacher','classroom']){
 let app,page;const home=path.join(root,role);fs.mkdirSync(home);
 try{
  app=await _electron.launch({executablePath:appPath+'/Contents/MacOS/Mochi',args:['--role='+role,'--user-data-dir='+path.join(root,role+'-browser'),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,DSH_TELEMETRY_DISABLED:'1'},timeout:60000});
  const versions=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged,resources:process.resourcesPath}));assert.equal(versions.electron,'44.0.0');assert.equal(versions.packaged,true);assert.equal(versions.resources,resources);
  for(let i=0;i<650;i++){page=app.windows().find(p=>/^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));if(page)break;await new Promise(r=>setTimeout(r,100))}assert.ok(page,'actual App creates Host');
  page.on('pageerror',e=>errors.push({role,message:e.message}));page.on('console',m=>{if(m.type()==='error'&&/slot entry crashed|Cannot find module|module.*not.*found/.test(m.text()))errors.push({role,message:m.text().slice(0,400)})});
  await app.evaluate(({BrowserWindow},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);w.setSize(880,840);w.show();w.focus()},page.url());
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.locator('[data-mochi-user-address]').click();
  await app.evaluate(({BrowserWindow},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url);w.webContents.focus();return w.webContents.insertText('新包侧栏验收')},page.url());
  await page.getByRole('button',{name:'保存称呼',exact:true}).click();await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();
  let guideComplete=false;for(let i=0;i<100;i++){
   const next=page.getByRole('button',{name:'我了解了，下一步',exact:true}),finish=page.getByRole('button',{name:'完成指引',exact:true});
   if(await next.isVisible()&&await next.isEnabled())await next.click({timeout:2000});
   else if(await finish.isVisible()&&await finish.isEnabled()){await finish.click({timeout:2000});await page.locator('.mochi-guide').waitFor({state:'hidden',timeout:5000});guideComplete=true;break}
   await page.waitForTimeout(200);
  }assert.ok(guideComplete,'mandatory seven steps actually finish');
  await page.reload();await page.locator('[data-mochi-sidebar-action="记忆"]').waitFor();await page.waitForTimeout(500);assert.equal(await page.locator('.mochi-guide').filter({visible:true}).count(),0,'completed guide stays complete after reload');
  results.push({role,name:'mandatory-guide',completed:true,reloadPersistent:true,versions});save(false);
  const measure=async wide=>{
   await page.locator('[data-mochi-sidebar-action="记忆"][data-wide="'+wide+'"]').waitFor();await page.waitForTimeout(350);
   const geometry=await page.locator('[data-slot="sidebar.footer.action"]').evaluate(slot=>{
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const side=slot.closest('[data-slot="sidebar"]');
    const root=[...side.children].find(n=>n.getBoundingClientRect().width>0&&n.contains(slot));
    if(!root)throw Error('Sidebar must have a visible boxed root, not a display:contents anchor');
    return {sidebar:rect(root),footer:rect(slot.parentElement),entries:[...slot.querySelectorAll('button')].map(n=>{
     const r=rect(n),s=getComputedStyle(n),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
     return {...r,label:n.getAttribute('aria-label')||n.textContent,text:n.textContent,wide:n.dataset.wide,own:!!n.dataset.mochiSidebarAction,
      icon:!!n.querySelector('svg'),hit:!!hit&&(hit===n||n.contains(hit)),clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,border:s.borderWidth,background:s.backgroundColor};
    })};
   });
   const {sidebar,footer,entries}=geometry;
   assert.ok(sidebar.width>0&&sidebar.height>0,'zero-box slot anchors cannot establish containment');
   assert.equal(entries.length,role==='teacher'?3:5,'all LAN/assistant/memory/planner/guide contributors visible');
   assert.ok(footer.x>=sidebar.x-.5&&footer.right<=sidebar.right+.5,'entire footer inside sidebar');
   for(let i=0;i<entries.length;i++){
    const e=entries[i];assert.ok(e.x>=sidebar.x-.5&&e.right<=sidebar.right+.5&&e.y>=sidebar.y&&e.bottom<=sidebar.bottom,'all entry bounds inside actual sidebar: '+e.label);
    assert.ok(e.width>0&&e.height>0&&e.hit,'entry is visible and receives pointer: '+e.label);
    if(i)assert.ok(e.y>=entries[i-1].bottom-.5,'entries do not overlap');
    assert.equal(e.clientWidth,e.scrollWidth,'no entry text overflow');
    if(e.own){assert.equal(e.wide,String(wide));assert.ok(e.icon);if(!wide){assert.equal(e.text,'');assert.equal(e.width,36);assert.equal(e.height,36)}else assert.ok(e.text.length>0)}
   }
   results.push({role,name:wide?'wide':'rail',...geometry});save(false);await page.screenshot({path:output+'/'+role+'-'+(wide?'wide':'rail')+'.png',timeout:5000});
  };
  await measure(false);await page.getByRole('button',{name:'打开侧边栏',exact:true}).click();await measure(true);
  await page.getByRole('button',{name:'查看记忆',exact:true}).click();await page.locator('dialog.mochi-memory-panel').waitFor();await page.locator('dialog.mochi-memory-panel').getByRole('button',{name:'关闭',exact:true}).click();
  if(role==='classroom'){await page.getByRole('button',{name:'课堂管家',exact:true}).click();await page.locator('dialog.mochi-planner').waitFor();await page.getByRole('button',{name:'关闭课堂日历',exact:true}).click()}
  await page.getByRole('button',{name:'新手指引',exact:true}).click();await page.locator('.mochi-guide').waitFor();await page.getByRole('button',{name:'关闭重看指引',exact:true}).click();
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await measure(false);
  for(const label of role==='teacher'?['查看记忆','新手指引']:['查看记忆','课堂管家','新手指引']){const entry=page.getByRole('button',{name:label,exact:true});await entry.hover();await page.getByRole('tooltip').filter({hasText:label}).waitFor({timeout:3000});await page.mouse.move(400,40)}
  await page.getByRole('button',{name:'摄像头或展台拍题',exact:true}).click();
  const camera=page.locator('dialog.mochi-camera__dialog');await camera.waitFor({state:'visible'});
  const cameraShell=await camera.evaluate(n=>{const s=getComputedStyle(n),v=getComputedStyle(n.querySelector('video')),r=n.getBoundingClientRect();return {backgroundImage:s.backgroundImage,boxShadow:s.boxShadow,videoBackgroundImage:v.backgroundImage,videoBackground:v.backgroundColor,width:r.width,height:r.height,viewport:innerWidth,closeVisible:!!n.querySelector('[aria-label="关闭拍题并释放设备"]')}});
  assert.match(cameraShell.backgroundImage,/radial-gradient/);assert.match(cameraShell.backgroundImage,/linear-gradient/);assert.notEqual(cameraShell.boxShadow,'none');assert.equal(cameraShell.videoBackgroundImage,'none');assert.ok(cameraShell.closeVisible&&cameraShell.width<=cameraShell.viewport);
  await page.screenshot({path:output+'/'+role+'-camera-shell.png',timeout:5000});await page.getByRole('button',{name:'关闭拍题并释放设备',exact:true}).click();
  results.push({role,name:'camera-paper-shell',...cameraShell,syntheticCamera:true});
  results.push({role,name:'entry-clicks-tooltips',passed:true});save(false);console.log(role+' actual packaged footer passed');
 }catch(e){if(page){await page.screenshot({path:output+'/'+role+'-failure.png',timeout:3000}).catch(()=>{});fs.writeFileSync(output+'/'+role+'-failure.txt',await page.locator('body').innerText().catch(()=>''))}throw e}
 finally{await app?.close()}
}assert.deepEqual(errors,[]);for(const [name,h]of Object.entries(clientHashes))assert.equal(hash(resources+'/mochi/plugins/'+name+'/client.js'),h);save(true);console.log(JSON.stringify({passed:true,clientHashes,count:results.length,errors}));
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{save(false);console.error(String(e.message));process.exitCode=1});
