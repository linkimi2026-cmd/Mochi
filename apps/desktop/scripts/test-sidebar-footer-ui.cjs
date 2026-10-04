#!/usr/bin/env node
// Real source profiles and official primitives; separate from packaged-App evidence.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{spawn}=require('child_process'),{createRequire}=require('module');
const repo=path.resolve(__dirname,'../../..'),req=createRequire(repo+'/apps/desktop/package.json'),{_electron}=req('playwright');
const runtime=req(repo+'/apps/desktop/resources/mochi-web/runtime-profile.cjs'),modules=path.resolve(process.argv[2]||repo+'/apps/desktop/runtime-modern/node_modules'),electron=req('electron-modern');
const output=repo+'/docs/evidence/harness-upgrade-2026-09-30/sidebar-footer',root=fs.mkdtempSync('/tmp/mochi-sidebar-footer-'),results=[],errors=[];
fs.mkdirSync(output,{recursive:true});
(async()=>{try{for(const role of ['teacher','classroom']){
 let host,app,log='';const home=path.join(root,role);
 runtime.provisionMochiProfiles({homeDir:home,resourceRoot:repo+'/apps/desktop/resources/mochi-web',workspaceRoot:repo,skillsDir:repo+'/skills',runtimeNodeModulesRoot:modules,role});
 try{
  host=spawn(electron,['--expose-internals',modules+'/@deepseek-ai/dsh/lib/bin.js','--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:modules,ELECTRON_RUN_AS_NODE:'1',DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  const collect=x=>log=(log+x).slice(-30000);host.stdout.on('data',collect);host.stderr.on('data',collect);
  let url;for(let i=0;i<600;i++){url=log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];if(url)break;if(host.exitCode!==null)throw Error(log.replace(/token=\S+/g,'token=[redacted]').slice(-1500));await new Promise(r=>setTimeout(r,100))}assert.ok(url,'source Host ready');
  const main=path.join(root,role+'-main.cjs');fs.writeFileSync(main,"const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:true,width:880,height:840,webPreferences:{backgroundThrottling:false}}).loadURL('about:blank'))");
  app=await _electron.launch({executablePath:electron,args:[main,'--user-data-dir='+home+'/browser']});const p=await app.firstWindow();
  p.on('pageerror',e=>errors.push({role,message:e.message}));p.on('console',m=>{if(m.type()==='error'&&/slot entry crashed|Cannot find module|module.*not.*found/.test(m.text()))errors.push({role,message:m.text().slice(0,400)})});
  await p.goto(url);await p.getByRole('button',{name:'继续',exact:true}).click();await p.getByRole('button',{name:'关闭小信箱',exact:true}).click();
  for(let i=0;i<20;i++){const next=p.getByRole('button',{name:'我了解了，下一步',exact:true}),finish=p.getByRole('button',{name:'完成指引',exact:true});if(await next.isVisible()){await next.click();await p.waitForTimeout(150)}else if(await finish.isVisible()){await finish.click();break}else await p.waitForTimeout(150)}
  const measure=async wide=>{
   await p.locator('[data-mochi-sidebar-action="记忆"][data-wide="'+wide+'"]').waitFor();await p.waitForTimeout(400);
   const entries=await p.locator('[data-slot="sidebar.footer.action"] [data-mochi-sidebar-action]').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {label:n.getAttribute('aria-label'),text:n.textContent,wide:n.dataset.wide,icon:!!n.querySelector('svg'),width:r.width,height:r.height,x:r.x,right:r.right,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,border:s.borderWidth,background:s.backgroundColor}}));
   assert.equal(entries.length,role==='teacher'?2:3);for(const e of entries){assert.equal(e.wide,String(wide));assert.ok(e.icon);assert.ok(e.right<=880);assert.equal(e.clientWidth,e.scrollWidth);if(!wide){assert.equal(e.text,'');assert.equal(e.width,36);assert.equal(e.height,36)}else assert.ok(e.text.length>0)}
   await p.screenshot({path:output+'/'+role+'-'+(wide?'wide':'rail')+'.png',timeout:5000});results.push({role,wide,entries});
  };
  await measure(false);await p.getByRole('button',{name:'打开侧边栏',exact:true}).click();await measure(true);
  await p.getByRole('button',{name:'查看记忆',exact:true}).click();await p.locator('dialog.mochi-memory-panel').waitFor();await p.locator('dialog.mochi-memory-panel').getByRole('button',{name:'关闭',exact:true}).click();
  if(role==='classroom'){await p.getByRole('button',{name:'课堂管家',exact:true}).click();await p.locator('dialog.mochi-planner').waitFor();await p.getByRole('button',{name:'关闭课堂日历',exact:true}).click()}
  await p.getByRole('button',{name:'新手指引',exact:true}).click();await p.locator('.mochi-guide').waitFor();await p.getByRole('button',{name:'关闭重看指引',exact:true}).click();
  await p.getByRole('button',{name:'收起侧边栏',exact:true}).click();await measure(false);
  for(const label of role==='teacher'?['查看记忆','新手指引']:['查看记忆','课堂管家','新手指引']){const entry=p.getByRole('button',{name:label,exact:true});await entry.focus();await p.getByRole('tooltip').filter({hasText:label}).waitFor();await p.keyboard.press('Tab')}
  console.log(role+' sidebar source UI passed');
 }finally{await app?.close();if(host?.exitCode===null)await new Promise(done=>{const timeout=setTimeout(()=>{host.kill('SIGKILL');done()},5000);host.once('exit',()=>{clearTimeout(timeout);done()});host.kill('SIGTERM')})}
}
assert.deepEqual(errors,[]);fs.writeFileSync(output+'/checkpoints.json',JSON.stringify({passed:true,electron:'44.0.0',sourceHost:true,results,errors,noModelCalls:true},null,2)+'\n');console.log(JSON.stringify({passed:true,count:results.length,errors}));
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{fs.writeFileSync(output+'/failure.txt',String(e.message).replace(/token=\S+/g,'token=[redacted]'));console.error(String(e.message).replace(/token=\S+/g,'token=[redacted]'));process.exitCode=1});
