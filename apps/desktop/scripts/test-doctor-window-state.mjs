#!/usr/bin/env node
// Window lifecycle/state tests without launching GUI or contacting providers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{buildSync}=require('esbuild'),typescript=require('typescript');
const root=mkdtempSync(join(tmpdir(),'mochi-doctor-state-'));test.after(()=>rmSync(root,{recursive:true,force:true}));
const source=join(import.meta.dirname,'../electron/dsh/doctor-window.ts');
const compiled=buildSync({entryPoints:[source],bundle:true,platform:'node',format:'cjs',external:['electron'],write:false}).outputFiles[0].text;
const result={overallStatus:'pass',totalDurationMs:1,checks:[],recentDiagnostics:[{stage:'web-host',code:'WEB_HOST_PROFILE_PREPARATION_FAILED'}]};
const tick=()=>new Promise(r=>setImmediate(r));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await tick()}throw Error('Window state did not settle')}
function harness(deps){
 const windows=[];
 class Window extends EventEmitter{
  destroyed=false;url='';pages=[];scripts=[];focusId='doctor-save';scrollY=164;
  constructor(){super();windows.push(this);this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler:()=>{},getURL:()=>this.url,executeJavaScript:async expression=>{this.scripts.push(expression);return {focusId:this.focusId,scrollY:this.scrollY}}})}
  isDestroyed(){return this.destroyed}isMinimized(){return false}isVisible(){return false}show(){}focus(){}restore(){}
  async loadURL(url){this.url=url;this.pages.push(decodeURIComponent(url.slice(url.indexOf(',')+1)))}
  close(){this.destroyed=true;this.emit('closed')}
  navigate(url){let prevented=false;this.webContents.emit('will-navigate',{preventDefault(){prevented=true}},url);assert.equal(prevented,true)}
 }
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>id==='electron'?{BrowserWindow:Window,app:{},clipboard:{},dialog:{},Menu:{}}:require(id),AbortController,URL,console,process,setTimeout,clearTimeout,Buffer});
 const controller=module.exports.createDoctorWindowController({createConfig:()=>({}),dependencies:deps});controller.open();
 return {controller,windows,get window(){return windows.at(-1)},get html(){return windows.at(-1).pages.at(-1)}};
}
function enabledRerun(html){assert.match(html,/<button id="doctor-rerun" type="button">重新检测<\/button>/)}
test('failed diagnostics show an error and remain retryable without a fake report',async()=>{
 let calls=0;const h=harness({run:async()=>{if(++calls===1)throw Error('fixture');return result}});await until(()=>h.html.includes('本次没有生成'));
 enabledRerun(h.html);assert.match(h.html,/role="alert"/);assert.doesNotMatch(h.html,/id="doctor-copy"/);
 h.window.navigate('mochi-doctor://rerun');await until(()=>h.html.includes('本次检测 通过'));assert.equal(calls,2);enabledRerun(h.html);h.controller.cancel();
});
test('startup recovery separates historical failure from passing checks and never claims to restart',async()=>{
 const h=harness({run:async()=>result});await until(()=>h.html.includes('旧配置升级'));
 assert.match(h.html,/原设置仍保留/);assert.match(h.html,/重新检测只检查环境，不会重启工作界面/);assert.match(h.html,/WEB_HOST_PROFILE_PREPARATION_FAILED/);assert.match(h.html,/aria-live="polite"/);h.controller.cancel();
});
test('one pending save disables all report actions and rejects repeated requests',async()=>{
 let choose=0,writes=0,resolve;const h=harness({run:async()=>result,chooseSavePath:()=>{choose++;return new Promise(r=>resolve=r)},writeReport:async()=>writes++});await until(()=>h.html.includes('本次检测 通过'));
 h.window.navigate('mochi-doctor://save');h.window.navigate('mochi-doctor://save');h.window.navigate('mochi-doctor://copy');await until(()=>choose===1);
 assert.match(h.html,/aria-busy="true"/);assert.match(h.html,/id="doctor-save"[^>]*disabled>正在保存/);resolve('/fixture-report.json');await until(()=>h.html.includes('脱敏报告已保存'));
 assert.equal(writes,1);enabledRerun(h.html);assert.ok(h.window.scripts.some(s=>s.includes('window.scrollTo(0,164)')&&s.includes('"doctor-save"')));h.controller.cancel();
});
test('canceled save restores actions and focus without claiming completion',async()=>{
 const h=harness({run:async()=>result,chooseSavePath:async()=>undefined});await until(()=>h.html.includes('本次检测 通过'));
 h.window.navigate('mochi-doctor://save');await until(()=>h.html.includes('aria-busy="false"')&&h.window.pages.length>=4);enabledRerun(h.html);assert.doesNotMatch(h.html,/脱敏报告已保存/);h.controller.cancel();
});
test('closing during save cannot write into a reopened window or overwrite its state',async()=>{
 let resolve,writes=0;const h=harness({run:async()=>result,chooseSavePath:()=>new Promise(r=>resolve=r),writeReport:async()=>writes++});await until(()=>h.html.includes('本次检测 通过'));
 h.window.navigate('mochi-doctor://save');await until(()=>resolve);h.window.navigate('mochi-doctor://close');h.controller.open();await until(()=>h.html.includes('本次检测 通过'));resolve('/late-report.json');await tick();await tick();assert.equal(writes,0);enabledRerun(h.html);h.controller.cancel();
});
test('copy failure is error feedback and restores keyboard target',async()=>{
 const h=harness({run:async()=>result,writeClipboard:()=>{throw Error('fixture')}});await until(()=>h.html.includes('本次检测 通过'));
 h.window.navigate('mochi-doctor://copy');await until(()=>h.html.includes('未能复制'));assert.match(h.html,/notice error" role="alert"/);assert.ok(h.window.scripts.some(s=>s.includes('"doctor-copy"')&&s.includes('preventScroll:true')));h.controller.cancel();
});
test('Escape/close protocol aborts the active check; external navigation remains blocked',async()=>{
 let aborted=false,started=false;const h=harness({run:(_,signal)=>new Promise(resolve=>{started=true;signal.addEventListener('abort',()=>{aborted=true;resolve(result)})})});await until(()=>started);
 assert.match(h.html,/event.key==="Escape"/);h.window.navigate('https://fixture.invalid');assert.equal(h.window.destroyed,false);h.window.navigate('mochi-doctor://close');assert.equal(aborted,true);
});
// Compile only the three owned pure page functions, avoiding all main-process startup side effects.
const mainSource=readFileSync(join(import.meta.dirname,'../electron/main.ts'),'utf8');
const ast=typescript.createSourceFile('main.ts',mainSource,typescript.ScriptTarget.Latest,true);
const functions=ast.statements.filter(n=>typescript.isFunctionDeclaration(n)&&['startupStagePage','diagnosticText','errorPage'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const pages={PAPER_WINDOW_CSS:'button:focus-visible{outline:2px solid currentColor}',STARTUP_RETRY_URL:'mochi-startup://retry',STARTUP_COPY_DIAGNOSTIC_URL:'mochi-startup://copy-diagnostic'};
vm.createContext(pages);vm.runInContext(typescript.transpileModule(functions,{compilerOptions:{target:typescript.ScriptTarget.ES2022}}).outputText,pages);
const html=url=>decodeURIComponent(url.slice(url.indexOf(',')+1));
test('startup error prioritizes reason, preserved settings and next steps; copied focus is restored',()=>{
 const event={stage:'web-host',code:'WEB_HOST_PROFILE_PREPARATION_FAILED'},initial=html(pages.errorPage(event)),copied=html(pages.errorPage(event,true));
 assert.match(initial,/旧配置升级准备未完成/);assert.match(initial,/原设置已保留/);assert.ok(initial.indexOf('旧配置升级')<initial.indexOf('诊断代码'));
 assert.match(initial,/aria-describedby="failure-guidance"/);assert.match(initial,/正在重新启动/);assert.match(initial,/aria-busy/);assert.match(initial,/failure-title'\).focus/);
 assert.match(copied,/role="status"/);assert.match(copied,/getElementById\('copy'\).focus/);assert.match(pages.diagnosticText(event),/原设置已保留/);
});
test('stage announcements are readable, responsive and do not invent progress percentages',()=>{
 for(const stage of ['starting','stopping','restoring']){const page=html(pages.startupStagePage(stage));assert.match(page,/role="status"/);assert.match(page,/aria-busy="true"/);assert.match(page,/width:min\(440px,calc\(100% - 40px\)\)/);assert.doesNotMatch(page,/\d+%<\/p>/)}
});
