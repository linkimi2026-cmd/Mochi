#!/usr/bin/env node
// Guard the user's original colors; normalize interaction only, and test real pet SVGs.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { createRequire } from 'node:module';
const desktop=resolve(import.meta.dirname,'..'),repo=resolve(desktop,'../..');
const require=createRequire(join(desktop,'package.json'));
const {_electron}=require('playwright');
const {popupPageHtml,railPageHtml}=require('./dist-electron/dsh/rail-pages.js');
const {PET_PALETTES}=require('./dist-electron/dsh/pet-palettes.generated.js');
const root=mkdtempSync(join(tmpdir(),'mochi-controls-'));
const out=join(repo,'docs/evidence/pet-colors-2026-09-30');mkdirSync(out,{recursive:true});
const css=['jxl-theme-bridge.css','jxl-workspace.css','jxl-paper.css'].map(f=>readFileSync(join(repo,'client-plugins/jxl-theme/styles',f),'utf8')).join('\n');
const controls=readFileSync(join(repo,'client-plugins/jxl-theme/styles/mochi-controls.css'),'utf8');
let app;
try{
 const main=join(root,'main.cjs');writeFileSync(main,`const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{new BrowserWindow({width:700,height:400,show:true}).loadURL("about:blank")});`);
 app=await _electron.launch({executablePath:require('electron'),args:[main,`--user-data-dir=${join(root,'profile')}`]});
 const page=await app.firstWindow();await page.emulateMedia({reducedMotion:'reduce'});
 for(const dark of [false,true]){
  await page.setContent(`<style>${css}</style><body ${dark?'data-ds-dark-theme':''}><div data-composer-card><button aria-label="发送消息">发送</button></div><button class="mochi-lan-button">已读，撕下</button><button class="mochi-lan-button mochi-lan-button--soft">返回核对</button><button disabled>提交中</button></body>`);
  const colors=()=>page.locator('button:not(:disabled)').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return[s.backgroundColor,s.color,s.borderColor,s.boxShadow]}));
  const before=await colors();await page.addStyleTag({content:controls});assert.deepEqual(await colors(),before,'normalization preserves original colors, borders and shadows');
  await page.locator('button').first().focus();assert.equal(await page.locator('button').first().evaluate(n=>getComputedStyle(n).outlineStyle),'solid');
  assert.equal(await page.locator('button[disabled]').evaluate(n=>getComputedStyle(n).cursor),'not-allowed');
 }
 const withBridge=html=>html.replace('</head>','<script>window.mochiRail={onPetPalette(fn){window.selectPalette=fn},act(){}};</script></head>');
 await page.setViewportSize({width:552,height:280});await page.emulateMedia({colorScheme:'light'});
 await page.setContent(withBridge(popupPageHtml()));
 await page.evaluate(()=>render({id:'preview',title:'叮咚，Mochi 来送信啦～',subject:'小明 · 高一（3）班',detail:'下课后来办公室拿一下练习册吧。',receiptMessageId:'preview'}));
 const layout=await page.evaluate(()=>{const pet=document.querySelector('.popup-pet').getBoundingClientRect();const paper=document.querySelector('.pop').getBoundingClientRect();return{top:pet.top,left:pet.left,right:pet.right,paperLeft:paper.left,fits:receiptFits()}});
 assert.ok(layout.top<40&&layout.left<10&&layout.right<=layout.paperLeft,'Mochi stays at top left without covering paper');assert.equal(layout.fits,true);
 const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
 for(const p of PET_PALETTES){
  await page.evaluate(id=>selectPalette(id),p.id);
  assert.equal(await page.locator('.expressive-orb__body').evaluate(n=>getComputedStyle(n).fill),rgb(p.body));
  assert.equal(await page.locator('.expressive-orb__face').evaluate(n=>getComputedStyle(n).fill),rgb(p.eyes));
  await page.screenshot({path:join(out,`pet-message-${p.id}.png`),omitBackground:true});
 }
 await page.evaluate(()=>selectPalette('bad-palette'));
 assert.equal(await page.locator('html').getAttribute('data-mochi-pet-palette'),'peach','unknown palette cannot mutate appearance');
 await page.setViewportSize({width:96,height:96});await page.setContent(withBridge(railPageHtml('teacher-rail')));
 for(const p of PET_PALETTES){
  await page.evaluate(id=>selectPalette(id),p.id);
  assert.equal(await page.locator('.pet__laptop [fill="#4A3826"]').evaluate(n=>getComputedStyle(n).fill),rgb(p.case));
  await page.screenshot({path:join(out,`pet-${p.id}.png`),omitBackground:true});
 }
 console.log('PASS: original button colors preserved in light/dark; focus/disabled; top-left popup; all four real pet palettes and laptop colors; invalid palette rejected');
}finally{await app?.close();rmSync(root,{recursive:true,force:true})}
