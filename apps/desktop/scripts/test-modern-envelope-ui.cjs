#!/usr/bin/env node
// Complete isolated profiles and native Electron surfaces. No model or microphone calls.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {spawn} = require('child_process'), {createRequire} = require('module');
const repo = path.resolve(__dirname, '../../..'), req = createRequire(repo+'/apps/desktop/package.json');
const {_electron} = req('playwright'), runtime = req(repo+'/apps/desktop/resources/mochi-web/runtime-profile.cjs');
const modules = path.resolve(process.argv[2] || ''), output = path.resolve(process.argv[3] || repo+'/docs/evidence/harness-upgrade-2026-09-30/envelope');
assert.ok(process.argv[2], 'Pass verified candidate node_modules');
const root = fs.mkdtempSync('/tmp/mochi-envelope-ui-'), checkpoints = [], errors = [], unavailable = [], runtimeVersions = [];
const paper = fs.readFileSync(repo+'/client-plugins/jxl-theme/styles/jxl-paper.css', 'utf8');
const marker = '\n/* One letter-paper shell.', envelope = marker + paper.split(marker)[1];
fs.mkdirSync(output, {recursive:true});
(async()=>{try {
 for (const role of ['teacher','classroom']) {
  const home=path.join(root,role);let app,host,log='';
  runtime.provisionMochiProfiles({homeDir:home,resourceRoot:repo+'/apps/desktop/resources/mochi-web',skillsDir:repo+'/skills',workspaceRoot:repo,runtimeNodeModulesRoot:modules,role});
  try {
   host=spawn(process.execPath,[modules+'/@deepseek-ai/dsh/lib/bin.js','--profile','mochi-web','--port','0','--no-open'],{cwd:repo,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,NODE_PATH:modules,DSH_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
   host.stdout.on('data',x=>log=(log+x).slice(-50000));host.stderr.on('data',x=>log=(log+x).slice(-50000));
   let url;for(let i=0;i<550;i++){url=log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];if(url)break;if(host.exitCode!==null)throw Error(log.replace(/token=\S+/g,'token=[redacted]').slice(-2000));await new Promise(r=>setTimeout(r,100))}assert.ok(url,'Host ready');
   const main=path.join(root,role+'-main.cjs');fs.writeFileSync(main,`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:880,height:840}).loadURL('about:blank'));`);
   app=await _electron.launch({executablePath:process.argv[4] || req('electron'),args:[main,'--user-data-dir='+home+'/browser']});const p=await app.firstWindow();runtimeVersions.push({role,...await app.evaluate(()=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node}))});
   p.on('pageerror',e=>errors.push({role,message:e.message}));
   await p.addInitScript(()=>{window.mochiClassroomDesktop={getStartup:async()=>({supported:false,enabled:false}),onAudioActivity:()=>()=>{},onOpenLetter:()=>()=>{},onOpenReminder:()=>()=>{},reminderReady:async()=>true}});
   await p.goto(url);await p.getByRole('button',{name:'继续',exact:true}).click();await p.waitForTimeout(500);
   for(const name of ['稍后配置','关闭小信箱']){const b=p.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click()}
   for(let i=0;i<20;i++){const next=p.getByRole('button',{name:'我了解了，下一步',exact:true}),finish=p.getByRole('button',{name:'完成指引',exact:true});if(await next.isVisible()){await next.click();await p.waitForTimeout(250)}else if(await finish.isVisible()){await finish.click();break}else await p.waitForTimeout(150)}
   await p.waitForTimeout(400);
   const checkpoint=async(name,selector)=>{
    const surface=p.locator(selector).filter({visible:true}).first();await surface.waitFor();await p.waitForTimeout(450);
    const measure=async()=>({surface:await surface.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,backgroundImage:s.backgroundImage,backgroundColor:s.backgroundColor,shadow:s.boxShadow}}),buttons:await surface.locator('button').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {label:n.getAttribute('aria-label')||n.textContent,background:s.backgroundColor,color:s.color,x:r.x,y:r.y,width:r.width,height:r.height}}))});
    await p.evaluate(block=>{const s=document.getElementById('jxl-theme-bridge');window.__envelopeFull=s.textContent;s.textContent=s.textContent.replace(block,'')},envelope);const before=await measure();
    await p.evaluate(()=>{document.getElementById('jxl-theme-bridge').textContent=window.__envelopeFull;delete window.__envelopeFull});const after=await measure();
    assert.equal(after.surface.clientWidth,after.surface.scrollWidth,name+' no horizontal shell overflow');assert.ok(after.surface.backgroundImage.includes('radial-gradient'),name+' actual paper holes');
    if(name==='conversation'){const labels=new Set(before.buttons.map(b=>b.label));assert.deepEqual(after.buttons.filter(b=>labels.has(b.label)),before.buttons,name+' keeps mounted button color and geometry')}else assert.deepEqual(after.buttons,before.buttons,name+' keeps button color and geometry');
    for(const key of ['x','y','width','height'])assert.equal(after.surface[key],before.surface[key],name+' keeps '+key);
    await p.screenshot({path:path.join(output,role+'-'+name+'.png')});checkpoints.push({role,name,selector,before,after});fs.writeFileSync(path.join(output,'checkpoints.json'),JSON.stringify({checkpoints,errors},null,2));
   };
   await checkpoint('conversation','[data-conversation-content]');await checkpoint('composer','[data-composer-card]');
   await p.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-user-profile')));await checkpoint('identity','.mochi-lan-panel');await p.getByRole('button',{name:'关闭小信箱',exact:true}).click();
   await p.getByRole('button',{name:'查看记忆',exact:true}).click();await checkpoint('memory','.mochi-memory-panel');await p.locator('.mochi-memory-panel').getByRole('button',{name:'关闭',exact:true}).click();
   if(role==='classroom'){
    await p.getByRole('button',{name:'课堂管家',exact:true}).click();await checkpoint('timetable','.mochi-planner');await p.getByRole('button',{name:'关闭课堂日历',exact:true}).click();
    await p.locator('button[data-mochi-classroom-status]').click();await checkpoint('classroom-assistant','.mochi-classroom-panel');await p.locator('.mochi-classroom-panel').getByRole('button',{name:'关闭',exact:true}).click();
   }
   await p.getByRole('button',{name:'设置',exact:true}).click();if(role==='teacher'){await p.getByRole('button',{name:'登录校园账号',exact:true}).click();await checkpoint('campus','.jxl-widget-panel');await p.locator('.jxl-widget-panel__close').click();await p.getByRole('button',{name:'设置',exact:true}).click();}await checkpoint('settings','[role="dialog"]:has(> nav) > [class*="_content"]');
   for(const name of ['模型','内置插件','Agent 预设','侧边卡片']){const nav=p.getByRole('button',{name,exact:true});if(!await nav.count()){unavailable.push({role,name,reason:'not mounted in the existing role composition'});continue}await nav.click();await checkpoint('settings-'+name,'[role="dialog"]:has(> nav) > [class*="_content"]')}
   await p.keyboard.press('Escape');await p.getByRole('button',{name:'插件',exact:true}).click();await checkpoint('plugins','[data-plugin-panel]');
   for(const name of ['智能体团队','自动授权审查','自动化任务','语音输入','终端','Agent 循环','子智能体','网页搜索']){const entry=p.getByRole('button',{name:'查看 '+name,exact:true});await entry.click();await checkpoint('plugin-'+name,'[data-plugin-panel]');await p.getByText('插件列表',{exact:true}).click()}
   await p.evaluate(()=>window.dispatchEvent(new CustomEvent('mochi-open-onboarding')));await checkpoint('guide','.mochi-guide');const closeGuide=p.getByRole('button',{name:'关闭重看指引',exact:true});if(await closeGuide.isVisible())await closeGuide.click();await p.getByRole('button',{name:'自动化任务',exact:true}).click();await checkpoint('automation-tasks','[data-testid="task-manager-page"]');
  } finally {await app?.close();if(host?.exitCode===null)await new Promise(done=>{const timer=setTimeout(()=>{host.kill('SIGKILL');done()},5000);host.once('exit',()=>{clearTimeout(timer);done()});host.kill('SIGTERM')});}
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'checkpoints.json'),JSON.stringify({passed:true,checkpoints,errors,unavailable,runtimeVersions,noModelCalls:true,noRecording:true},null,2));console.log(JSON.stringify({passed:true,checkpoints:checkpoints.map(x=>x.role+'/'+x.name),errors,unavailable}));
} finally {fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(String(e.message).replace(/token=\S+/g,'token=[redacted]'));process.exitCode=1});
