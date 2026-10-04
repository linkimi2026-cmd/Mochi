import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(join(desktop,'package.json'));
const {_electron}=require('playwright');
const {BLOUB_MOTION_SOURCE}=require(join(desktop,'dist-electron/dsh/bloub-motion.generated.js'));
const root=mkdtempSync(join(tmpdir(),'mochi-bloub-ui-'));
const evidence=resolve(desktop,'../../docs/evidence/ui-paper-2026-09-27');mkdirSync(evidence,{recursive:true});
const states=[['idle','待机'],['thinking','思考'],['wink','眨眼'],['wide','留意'],['alert','提醒'],['notify','新消息'],['exclaim','错误'],['sleep','休息'],['egg','启动'],['hexagon','准备'],['play','回复'],['orbit','整理思路'],['swirl','过渡'],['burst','完成'],['comet','发送 / 处理中']];
const boot=JSON.parse(readFileSync(resolve(desktop,'../../client-plugins/jxl-theme/assets/mochi-loading.json')));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Mochi · 动作检查</title><style>
:root{color-scheme:light}body{margin:0;background:#f6f3ec;color:#34332f;font:14px/1.5 system-ui;padding:32px}h1{font-size:24px;font-weight:550;margin:0 0 4px}p{color:#706b60;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.cell{text-align:center;padding:8px;border-bottom:1px solid #ded8cc}svg{width:100px;height:100px;display:block;margin:auto}button{padding:8px 14px;background:#fffdf8;border:1px solid #d3cebf;border-radius:7px;color:inherit;margin:12px 8px 0 0;font:inherit}.controls{display:flex;align-items:center;gap:12px}.controls svg{margin:0;width:70px;height:70px}.boot{position:absolute;left:-1000px}${boot.css}
@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background:#242320;color:#f1ede4}p{color:#b4ac9e}button{background:#302d28;border-color:#4a463e}.cell{border-color:#454039}}
</style><h1>Mochi · 动作检查</h1><p>点击动作查看实时播放，再切换下方状态检查衔接效果。</p><div class="grid">${states.map(([id,label])=>`<div class="cell"><svg id="${id}"></svg><button data-motion="${id}">${label}</button></div>`).join('')}</div><div class="controls"><svg id="live"></svg><div>${['thinking','typing','alert','celebrate','error','idle'].map(id=>`<button data-state="${id}">${({thinking:'思考',typing:'回复',alert:'等待确认',celebrate:'完成',error:'错误',idle:'待机'})[id]}</button>`).join('')}</div></div><div class="boot">${boot.markup}</div><script>${BLOUB_MOTION_SOURCE}</script><script>
window.controllers=[];for(const [id] of ${JSON.stringify(states)}) controllers.push(MochiMotion.mountMotion(document.getElementById(id),{motion:id,active:false}));
window.live=MochiMotion.mountMotion(document.getElementById('live'),{state:'idle'});
document.querySelectorAll('button[data-state]').forEach(button=>button.onclick=()=>live.update({state:button.dataset.state,motion:undefined}));
document.querySelectorAll('button[data-motion]').forEach(button=>button.onclick=()=>live.update({motion:button.dataset.motion}));
window.bootMotion=MochiMotion.mountMotion(document.querySelector('.boot .expressive-orb__svg'),{state:'boot'});
</script></html>`;
const preview=join(evidence,'bloub-motion-preview.html');writeFileSync(preview,html);
const main=join(root,'main.cjs');writeFileSync(main,`const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(()=>{new BrowserWindow({width:1080,height:840,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true}}).loadFile(${JSON.stringify(preview)});});`);
let app;
try{
 app=await _electron.launch({args:[main,'--user-data-dir='+join(root,'profile')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>window.live);
 assert.equal(await page.locator('[data-engine="bloub"]').count(),17);
 const paths=()=>page.locator('#live').innerHTML();
 await page.locator('.controls').getByRole('button',{name:'思考',exact:true}).click();const first=await paths();await page.waitForTimeout(450);assert.notEqual(await paths(),first,'thinking animates');
 await page.locator('.controls').getByRole('button',{name:'等待确认',exact:true}).click();await page.waitForTimeout(80);await page.locator('.controls').getByRole('button',{name:'回复',exact:true}).click();await page.waitForTimeout(500);
 assert.equal(await page.locator('#live').getAttribute('data-motion'),'play');
 assert.ok(!(await paths()).match(/NaN|Infinity/));
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);const still=await paths();await page.waitForTimeout(400);assert.equal(await paths(),still,'reduced motion freezes frame');
 await page.locator('.controls').getByRole('button',{name:'错误',exact:true}).click();assert.equal(await page.locator('#live').getAttribute('data-motion'),'exclaim','static mode still communicates state');
 await page.screenshot({path:join(evidence,'bloub-states-light.png')});
 await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(evidence,'bloub-states-dark.png')});
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('.controls').getByRole('button',{name:'思考',exact:true}).click();
 await page.evaluate(()=>live.dispose());const disposed=await paths();await page.waitForTimeout(300);assert.equal(await paths(),disposed,'dispose stops drawing');
 assert.deepEqual(errors,[]);console.log('[bloub-ui] PASS: 15 states, interruption, reduced motion, disposal; preview:',preview);
}finally{await app?.close();rmSync(root,{recursive:true,force:true});}
