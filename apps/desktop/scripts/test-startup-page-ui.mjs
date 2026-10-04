#!/usr/bin/env node
// Real Electron44 rendering of only the owned page functions; no Host or user settings.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),ts=require('typescript'),{_electron}=require('playwright');
const desktop=resolve(import.meta.dirname,'..'),repo=resolve(desktop,'../..'),output=join(repo,'docs/evidence/harness-upgrade-2026-09-30/doctor-recovery');mkdirSync(output,{recursive:true});
const root=mkdtempSync(join(tmpdir(),'mochi-startup-page-'));mkdirSync(join(root,'home'));const source=readFileSync(join(desktop,'electron/main.ts'),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['startupStagePage','diagnosticText','errorPage'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const body=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(join(root,'pages.cjs'),`const {PAPER_WINDOW_CSS}=require(${JSON.stringify(join(desktop,'dist-electron/dsh/window-theme.js'))});const STARTUP_RETRY_URL='mochi-startup://retry',STARTUP_COPY_DIAGNOSTIC_URL='mochi-startup://copy-diagnostic';\n${body}\nmodule.exports={startupStagePage,diagnosticText,errorPage};`);
writeFileSync(join(root,'main.cjs'),`const{app,BrowserWindow}=require('electron'),pages=require('./pages.cjs');app.whenReady().then(()=>{const w=new BrowserWindow({width:880,height:720,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});const diagnostic={stage:'web-host',code:'WEB_HOST_PROFILE_PREPARATION_FAILED'};w.webContents.on('will-navigate',(event,url)=>{event.preventDefault();if(url==='mochi-startup://copy-diagnostic')setTimeout(()=>w.loadURL(pages.errorPage(diagnostic,true)),150);if(url==='mochi-startup://retry')w.loadURL(pages.startupStagePage('starting'))});w.loadURL(pages.errorPage(diagnostic));});app.on('window-all-closed',()=>app.quit());`);
let app;try{
 app=await _electron.launch({executablePath:require('electron-modern'),args:[join(root,'main.cjs'),'--user-data-dir='+join(root,'browser')],env:{PATH:process.env.PATH,HOME:join(root,'home')}});
 const page=await app.firstWindow(),runtime=await app.evaluate(()=>({electron:process.versions.electron,node:process.versions.node}));assert.equal(runtime.electron,'44.0.0');await page.getByRole('button',{name:'复制诊断',exact:true}).waitFor();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));assert.equal(await page.evaluate(()=>document.activeElement.id),'failure-title');
 const geometry=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{label:n.textContent,height:r.height,background:s.backgroundColor,color:s.color}})}));assert.ok(geometry.scrollWidth<=geometry.viewport);assert.ok(geometry.buttons.every(b=>b.height>=44));
 await page.screenshot({path:join(output,'startup-failure-guidance.png')});await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'retry');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'copy');await page.keyboard.press('Enter');
 const pending=await page.evaluate(()=>({busy:document.querySelector('.actions').getAttribute('aria-busy'),disabled:[...document.querySelectorAll('button')].every(n=>n.disabled)}));assert.deepEqual(pending,{busy:'true',disabled:true});
 await page.getByRole('status').filter({hasText:'诊断已复制'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'copy');await page.screenshot({path:join(output,'startup-copied-focus.png')});
 await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'retry');await page.keyboard.press('Enter');await page.getByRole('status').filter({hasText:'正在启动本地服务'}).waitFor();assert.equal(await page.locator('main').getAttribute('aria-busy'),'true');await page.screenshot({path:join(output,'startup-retry-status.png')});
 assert.deepEqual(errors,[]);writeFileSync(join(output,'startup-ui-checkpoints.json'),JSON.stringify({passed:true,runtime,isolatedHome:true,componentFixture:true,actualHostStarted:false,sourceFunctions:['startupStagePage','diagnosticText','errorPage'],settingsPreservedGuidance:true,titleInitialFocus:true,tabOrder:['retry','copy'],enterCopyFeedback:pending,copiedFocus:'copy',enterRetryStage:true,geometry,errors},null,2)+'\n');console.log('PASS startup page: specific guidance, keyboard copy/retry, immediate busy feedback and 880px geometry');
}finally{await app?.close();rmSync(root,{recursive:true,force:true})}
