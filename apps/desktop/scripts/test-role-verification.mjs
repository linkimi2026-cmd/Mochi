import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const root = mkdtempSync(join(tmpdir(), 'mochi-role-auth-test-'));
const modulePath = resolve(new URL('../dist-electron/dsh/role-verification.js', import.meta.url).pathname);
let loggedIn = false;
const server = createServer((req,res) => {
  if (req.url === '/api/auth/login' && req.method === 'POST') {
    loggedIn = true;res.writeHead(200, {'Content-Type':'application/json','Set-Cookie':'fixture=teacher; Path=/; HttpOnly; SameSite=Lax'});res.end('{}');return;
  }
  if (req.url === '/api/auth/me') {
    res.writeHead(loggedIn && req.headers.cookie?.includes('fixture=teacher') ? 200 : 401, {'Content-Type':'application/json'});
    res.end(JSON.stringify({user:{id:1,role:'HEAD_TEACHER',mustChangePassword:false}}));return;
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<button onclick="fetch(\'/api/auth/login\',{method:\'POST\'})">登录测试教师</button>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const main = join(root,'main.cjs');
writeFileSync(main, `const {app,dialog}=require('electron');const {verifyTeacherIdentity,isVerifiedTeacherIdentity}=require(${JSON.stringify(modulePath)});app.whenReady().then(()=>{ global.validate=isVerifiedTeacherIdentity;global.run=()=>{global.answer='pending';verifyTeacherIdentity(${JSON.stringify(origin)}).then(v=>global.answer=v)};global.run();});app.on('window-all-closed',()=>{});`);
let electron;
try {
  electron = await _electron.launch({args:[main, '--user-data-dir='+join(root,'profile')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
  electron.process().stderr.on("data", chunk => process.stderr.write(chunk));
  const page = await electron.firstWindow();
  await page.getByRole('button',{name:'登录测试教师'}).waitFor();
  assert.equal(await electron.evaluate(()=>global.answer),'pending');
  await page.getByRole('button',{name:'登录测试教师'}).click();
  for(let i=0;i<60 && await electron.evaluate(()=>global.answer)==='pending';i++) await new Promise(r=>setTimeout(r,100));
  assert.equal(await electron.evaluate(()=>global.answer),true,'main-process /me must observe the ephemeral login cookie');
  assert.equal(await electron.evaluate(()=>global.validate({user:{id:2,role:'STUDENT',mustChangePassword:false}})),false);
  assert.equal(await electron.evaluate(()=>global.validate({user:{id:1,role:'HEAD_TEACHER',mustChangePassword:true}})),false);
  const nextWindow = electron.waitForEvent('window');
  await electron.evaluate(()=>global.run());
  const second = await nextWindow;
  await second.getByRole('button',{name:'登录测试教师'}).waitFor();
  assert.equal(await electron.evaluate(()=>global.answer),'pending','each verification needs a fresh credential login');
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  for(let i=0;i<30 && await electron.evaluate(()=>global.answer)==='pending';i++) await new Promise(r=>setTimeout(r,50));
  assert.equal(await electron.evaluate(()=>global.answer),false,'closing verification must deny');
  const source = readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8');
  assert.ok(source.indexOf('const verified = await verifyTeacherIdentity') < source.indexOf('runtimeRole = selectedRole;'));
  assert.ok(source.includes('void switchLaunchRole(incomingRole)'));
  console.log('[role-verification] PASS: actual Electron login cookie, main-process role check, fresh partition, cancel denies, startup gate ordering');
} finally { await electron?.close();server.close();rmSync(root,{recursive:true,force:true}); }
