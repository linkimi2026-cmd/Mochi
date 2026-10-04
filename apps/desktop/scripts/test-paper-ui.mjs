#!/usr/bin/env node
/** Real frontend plugins in an isolated Electron window; LAN transport and theme service are fixtures. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createMechanicalAudio } from '../../../client-plugins/jxl-theme/scripts/mechanical-audio.mjs';
import { installPaperFeedback } from '../../../client-plugins/jxl-theme/scripts/paper-runtime.mjs';
import { checkPaperAppearance } from './paper-ui-checks.mjs';
const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(desktop, '../..');
const require = createRequire(join(desktop, 'package.json'));
const { _electron } = require('playwright');
const root = mkdtempSync(join(tmpdir(), 'mochi-paper-ui-'));
const evidence = process.env.MOCHI_PAPER_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const teacher = { endpointId:'teacher-1',role:'teacher',schoolId:'嘉兴一中',displayName:'王老师',fingerprint:'sha256:teacher' };
const classroom = { endpointId:'room-1',role:'classroom',schoolId:'嘉兴一中',classId:'高一（3）班',displayName:'一班教室',fingerprint:'sha256:room' };
let snapshot = { configured:true, lockedRole:'teacher', identity:teacher, peers:[classroom], inbox:[{
  messageId:'paper-request',from:classroom,recipient:teacher,contentType:'REQUEST',seenAt:'',receivedAt:'2026-09-27T08:30:00Z',
  request:{kind:'appointment',student:'张小明',slot:'今天第八节晚自习',material:'数学练习册',position:'第 3 题',topic:'二次函数'},
  body:'老师，我想请您讲解二次函数这道题。',
}], outbox:[], receipts:[] };
const css = ['jxl-theme-bridge.css','jxl-workspace.css','jxl-paper.css','mochi-controls.css'].map(name => readFileSync(join(repo,'client-plugins/jxl-theme/styles',name),'utf8')).join('\n');
const bootstrap = `
window.fixtureErrors=[];window.addEventListener('error',event=>window.fixtureErrors.push(event.message));
const plugins={}; window.__ModuleLoader__={load({id,factory}){plugins[id]=factory(name=>{if(name==='react')return React;throw Error(name)})}};
window.paperPlugins=plugins;
`;
const run = `
let preference=localStorage.getItem('paper-fixture-theme')||'light';
const listeners=new Set(); const components={}; const cleanup=[];
function paint(){document.body.toggleAttribute('data-ds-dark-theme',preference==='dark'||preference==='system'&&matchMedia('(prefers-color-scheme:dark)').matches)}
paint();
const scope={theme:{getTheme:()=>({preference}),setTheme(value){preference=value;localStorage.setItem('paper-fixture-theme',value);paint();listeners.forEach(fn=>fn({preference}))}},on(_,fn){listeners.add(fn);return()=>listeners.delete(fn)},effect(fn){cleanup.push(fn())},slots:{register(info,Component){components[info.id]=Component},inject(_,fn){const result=fn();if(result?.next)for(const item of result){}}}};
let soundSnapshot={status:'ready',writable:true,value:{uiSound:window.fixtureSound}};
const soundListeners=new Set();
const settingsScope={bind(){return {getSnapshot:()=>soundSnapshot,subscribe(fn){soundListeners.add(fn);return()=>soundListeners.delete(fn)},async set(field,value){const response=await fetch('/sound',{method:'POST',body:JSON.stringify(value)});if(!response.ok)throw Error('save');soundSnapshot={...soundSnapshot,value:{...soundSnapshot.value,[field]:value}};soundListeners.forEach(fn=>fn())}}}};
(${installPaperFeedback.toString()})({settingsScope,effect:scope.effect,inject(_,fn){fn(scope)}},React,${createMechanicalAudio.toString()});
window.paperPlugins['mochi-lan-client'].apply(scope);
const h=React.createElement;
ReactDOM.createRoot(document.getElementById('fixture')).render(h(React.Fragment,null,
h('aside',null,h('p',null,'Mochi'),h(components['appearance'],{wide:true}),h(components['mochi-lan-entry'],{wide:true})),
h('main',{className:'fixture-chat'},h('h1',null,'今天，有什么需要处理的？'),h('div',{'data-composer-card':true},h('div',{'data-input-scroll':true},h('div',{'data-composer-input':true,'data-phase':'active',contentEditable:true,suppressContentEditableWarning:true},'请帮我查看今天的预约')))),
h(components['mochi-lan-overlay'])));
`;
const html = `<!doctype html><html lang="zh-CN" data-mochi-theme-host><meta charset="utf-8"><style>${css}\nbody{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:14px/1.6 system-ui}#fixture{display:flex;min-height:100vh}aside{width:200px;padding:24px;border-right:1px solid var(--dsw-alias-border-l2)}.fixture-chat{margin:auto;max-width:650px;flex:1;padding:36px}.fixture-chat h1{font-size:24px;font-weight:500;margin-bottom:32px}[data-composer-card]{padding:18px}[data-composer-input]{min-height:80px;outline:0}</style><div id="fixture"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${bootstrap}</script><script src="/lan.js"></script><script>${run}</script></html>`;
const files = {
  '/react.js':join(desktop,'node_modules/react/umd/react.development.js'),
  '/react-dom.js':join(desktop,'node_modules/react-dom/umd/react-dom.development.js'),
  '/lan.js':join(repo,'client-plugins/mochi-lan/client.js'),
};
const mutations=[];
let savedSound=true;
let receiptMode='failure';
const server=createServer((req,res)=>{
  if(req.url==='/sound'){let body='';req.on('data',part=>body+=part);req.on('end',()=>{savedSound=JSON.parse(body);res.end('{}')});return}
  if(files[req.url]){res.setHeader('Content-Type','application/javascript');res.end(readFileSync(files[req.url]));return}
  if(req.url.startsWith('/api/mochi-lan/')){
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST'){
      mutations.push(req.url);let body='';req.on('data',part=>body+=part);req.on('end',()=>{
        if(receiptMode==='failure'){res.statusCode=503;res.end(JSON.stringify({error:'UNAVAILABLE'}));return}
        const {messageId}=JSON.parse(body);const message=snapshot.inbox.find(item=>item.messageId===messageId);
        message.seenAt=new Date().toISOString();message.seenReceipt=receiptMode==='success'?'ACKNOWLEDGED':'UNKNOWN';
        res.end(JSON.stringify({messageId,status:message.seenReceipt}));
      });return;
    }
    res.end(JSON.stringify(req.url.endsWith('/state')?snapshot:req.url.includes('/discovery')?{candidates:[]}:{cursor:0,events:[]}));return;
  }
  res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html.replace('<script>'+bootstrap, '<script>window.fixtureSound='+JSON.stringify(savedSound)+';</script><script>'+bootstrap));
});
let app;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const main=join(root,'main.cjs');
  writeFileSync(main,`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({width:1120,height:840,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(origin)})});`);
  app=await _electron.launch({executablePath:require('electron'),args:[main,`--user-data-dir=${join(root,'profile')}`]});
  const page=await app.firstWindow();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForLoadState();
  const measureAudio = () => {
    const Base = window.AudioContext;
    window.audioEvidence = { created: 0, started: 0 };
    window.AudioContext = class extends Base {
      constructor(...args) { super(...args); window.audioEvidence.created++; }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => { window.audioEvidence.started++; return start(...args); };
        return source;
      }
    };
  };
  await page.addInitScript(measureAudio);
  await page.evaluate(measureAudio);

  assert.deepEqual(await page.evaluate(()=>window.fixtureErrors),[],"fixture startup");
  await checkPaperAppearance(page);
  await page.evaluate(()=>window.paperPlugins['mochi-lan-client'].__test.openLanPanel());
  const panel=page.locator('.mochi-lan-panel');
  await panel.getByText('预约讲题 · 张小明',{exact:true}).waitFor();
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backdropFilter),'none');
  assert.equal(await panel.locator('.mochi-lan-pane:visible').count(),1,'one content level at a time');
  await panel.getByRole('button',{name:'设备与连接',exact:true}).click();
  await panel.getByRole('heading',{name:'设备与连接',exact:true}).waitFor();
  assert.equal(await panel.getByText('预约讲题 · 张小明',{exact:true}).isVisible(),false,'connection details do not compete with requests');
  await panel.getByRole('button',{name:'返回消息',exact:true}).click();
  await panel.getByRole('button',{name:'使用说明',exact:true}).click();
  await panel.getByRole('heading',{name:'使用说明',exact:true}).waitFor();
  await panel.getByRole('button',{name:'返回消息',exact:true}).click();
  await panel.getByText('预约讲题 · 张小明',{exact:true}).waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.mochi-lan-overlay')).opacity==='1');
  if(evidence)await page.screenshot({path:join(evidence,'requests-light.png')});
  assert.equal(mutations.length,0,'reading letters never sends a receipt');
  await panel.getByRole('button',{name:'已读，撕下',exact:true}).click();
  await panel.locator('.mochi-lan-error').waitFor();
  assert.equal(mutations.length,1);
  assert.equal(await panel.getByRole('button',{name:'已读，撕下',exact:true}).isEnabled(),true,'failed receipt remains retryable');
  assert.equal(await page.locator('.mochi-letter-piece').count(),0,'failed receipt must not tear or hide paper');
  await page.setViewportSize({width:560,height:740});
  assert.equal(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'narrow panel does not overflow horizontally');
  if(evidence)await page.screenshot({path:join(evidence,'requests-narrow.png')});
  await page.setViewportSize({width:1120,height:800});
  await page.keyboard.press('Escape');
  await page.locator('.mochi-lan-overlay').waitFor({state:'hidden'});
  await page.locator('.jxl-theme-dial').press('End');
  await page.evaluate(()=>window.paperPlugins['mochi-lan-client'].__test.openLanPanel());
  await page.waitForTimeout(250);
  assert.equal(await panel.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(36, 35, 32)');
  if(evidence)await page.screenshot({path:join(evidence,'requests-dark.png')});
  receiptMode='unknown';
  await panel.getByRole('button',{name:'已读，撕下',exact:true}).click();
  await panel.getByText('已读回执尚未确认，信件已保留，请重试。',{exact:true}).waitFor();
  assert.equal(await page.locator('.mochi-letter-piece').count(),0,'unknown receipt must not tear paper');
  await panel.getByRole('button',{name:'重试已看到回执',exact:true}).waitFor();
  receiptMode='success';
  await panel.getByRole('button',{name:'重试已看到回执',exact:true}).click();
  await page.locator('.mochi-letter-piece').first().waitFor();
  if(evidence)await page.screenshot({path:join(evidence,'letter-tear.png')});
  await page.locator('.mochi-letter-piece').first().waitFor({state:'detached'});
  await panel.getByText('收好的信 · 1',{exact:true}).waitFor();
  assert.equal(await panel.getByText('预约讲题 · 张小明',{exact:true}).isVisible(),false,'read teacher letter leaves current inbox');
  await panel.getByText('收好的信 · 1',{exact:true}).click();
  await panel.getByText('预约讲题 · 张小明',{exact:true}).waitFor();
  assert.equal(await panel.locator('article').getByRole('button',{name:'已读，撕下',exact:true}).count(),0);

  await page.keyboard.press('Escape');
  const input=page.locator('[data-composer-input]');
  await input.evaluate(n=>n.setAttribute('data-phase','submitting'));
  await page.locator('[data-jxl-feeding]').waitFor();
  await input.evaluate(n=>n.setAttribute('data-phase','active'));
  await page.locator('[data-jxl-feeding]').waitFor({state:'detached'});
  assert.equal(await input.innerText(),'请帮我查看今天的预约','decorative feedback never clears a failed draft');

  await page.getByRole('button',{name:'关闭界面音效',exact:true}).click();
  await page.getByRole('button',{name:'开启界面音效',exact:true}).waitFor();
  assert.equal(savedSound,false,'preference is persisted by the Host');
  const before = await page.evaluate(()=>window.audioEvidence.started);
  await page.locator('.jxl-theme-dial').click();
  assert.equal(await page.evaluate(()=>window.audioEvidence.started),before,'muted controls do not create audio sources');
  await page.goto(origin.replace('127.0.0.1','localhost'));
  await page.getByRole('button',{name:'开启界面音效',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.audioEvidence.created),0,'saved mute remains lazy after reload');
  await page.getByRole('button',{name:'开启界面音效',exact:true}).click();
  await page.getByRole('button',{name:'关闭界面音效',exact:true}).waitFor();
  await page.locator('.jxl-theme-dial').click();
  await page.waitForFunction(()=>window.audioEvidence.started>0);
  await page.getByRole('button',{name:'关闭界面音效',exact:true}).click();
  const request = snapshot.inbox[0];
  snapshot = {
    configured: true, lockedRole: 'classroom', identity: classroom, peers: [teacher], receipts: [],
    outbox: [{ ...request, sender: classroom, peer: teacher, targetEndpointId: teacher.endpointId, delivery: 'ACKNOWLEDGED' }],
    inbox: [{ messageId: 'paper-reply', from: teacher, recipient: classroom, receivedAt: '2026-09-27T08:35:00Z', seenAt: '', body: '可以，今天晚自习来找我。', response: { replyToMessageId: request.messageId, decision: 'confirmed', slot: request.request.slot } }],
  };
  await page.reload();
  await page.locator('.jxl-theme-dial').press('Home');
  await page.evaluate(()=>window.paperPlugins['mochi-lan-client'].__test.openLanPanel());
  await panel.getByText('我的请求进度',{exact:true}).waitFor();
  await panel.getByText('确认时间：今天第八节晚自习',{exact:true}).first().waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.mochi-lan-overlay')).opacity==='1');
  if(evidence)await page.screenshot({path:join(evidence,'classroom-request-light.png')});
  const beforeClassroom = mutations.length;
  await page.emulateMedia({reducedMotion:'reduce'});
  await panel.getByRole('button',{name:'已读，撕下',exact:true}).last().click();
  await panel.getByText('收好的信 · 1',{exact:true}).waitFor();
  assert.equal(mutations.length,beforeClassroom+1,'one explicit read-and-tear sends exactly one receipt');
  assert.equal(await page.locator('.mochi-letter-piece').count(),0,'reduced motion skips paper movement');
  await page.reload();
  await page.evaluate(()=>window.paperPlugins['mochi-lan-client'].__test.openLanPanel());
  await panel.getByText('收好的信 · 1',{exact:true}).waitFor();
  assert.equal(await panel.getByText('确认时间：今天第八节晚自习',{exact:true}).isVisible(),false,'read classroom reply stays in history after reload');
  assert.deepEqual(errors,[]);
  console.log('[paper-ui] PASS: actual LAN React plugin: both mailboxes, read-and-tear, failed/unknown receipts retained, history after reload, Escape, night palette and reduced motion; failed draft preserved. Transport/theme service are isolated fixtures.');
} finally {
  if(app)await app.close();
  await new Promise(resolve=>server.close(resolve));
  rmSync(root,{recursive:true,force:true});
}
