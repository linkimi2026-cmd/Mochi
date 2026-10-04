#!/usr/bin/env node
// Actual complete Mochi profiles, authenticated management API, existing SQLite; no model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, openStore, defaultDbPath } from '../../../plugins/mochi-memory/mem-store.mjs';
import { ProactiveMemory, localObservations } from '../../../plugins/mochi-memory/proactive.mjs';
const [modulesArg, outputArg, mode] = process.argv.slice(2);
assert.ok(modulesArg && outputArg, 'Pass verified candidate node_modules and evidence directory');
assert.ok(mode === undefined || mode === 'observations', 'Optional mode: observations (teacher only)');
const modules = resolve(modulesArg), output = resolve(outputArg), repo = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(repo, 'apps/desktop/package.json')), { _electron } = require('playwright');
const runtime = require(join(repo, 'apps/desktop/resources/mochi-web/runtime-profile.cjs'));
const root = mkdtempSync(join(tmpdir(), 'mochi-memory-ui-')); mkdirSync(output, { recursive: true });
const results = [];
try {
  for (const role of mode === 'observations' ? ['teacher'] : ['teacher', 'classroom']) {
    const home = join(root, role), errors = []; let host, app, page, log = '';
    runtime.provisionMochiProfiles({ homeDir: home, resourceRoot: join(repo, 'apps/desktop/resources/mochi-web'),
      skillsDir: join(repo, 'skills'), workspaceRoot: repo, runtimeNodeModulesRoot: modules, role });
    const start = async () => {
      log = ''; host = spawn(process.execPath, [join(modules, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'mochi-web', '--port', '0', '--no-open'],
        { cwd: repo, env: { PATH: process.env.PATH, HOME: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: modules, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = chunk => { log = (log + chunk).slice(-30000); }; host.stdout.on('data', collect); host.stderr.on('data', collect);
      const end = Date.now() + 60000;
      while (Date.now() < end) { const url = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]; if (url) return url; if (host.exitCode !== null) break; await new Promise(done => setTimeout(done,100)); }
      throw Error(`Host startup failed: ${log.replace(/token=\S+/g,'token=[redacted]').slice(-3000)}`);
    };
    const stop = async () => { if(host?.exitCode === null) await new Promise(done => { const timeout = setTimeout(()=>{host.kill('SIGKILL');done();},5000);host.once('exit',()=>{clearTimeout(timeout);done();});host.kill('SIGTERM'); }); };
    try {
      const url = await start(), main = join(root, `${role}-main.cjs`);
      writeFileSync(main, `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:1120,height:840}).loadURL('about:blank'));`);
      app = await _electron.launch({ executablePath: require('electron'), args: [main, `--user-data-dir=${join(root, role+'-browser')}`] }); page = await app.firstWindow();
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if(message.type()==='error' && message.text().includes('slot entry crashed')) errors.push(message.text().replace(/token=\S+/g,'token=[redacted]').slice(0,500)); });
      await page.goto(url);
      await page.getByRole('button',{name:'继续',exact:true}).click();
      for(const name of ['稍后配置','稍后设置','返回消息']) { const button=page.getByRole('button',{name,exact:true}); if(await button.isVisible()) await button.click(); }
      const dismissFirstUse = async () => { const back=page.getByRole('button',{name:'关闭小信箱',exact:true});await back.waitFor({timeout:3000}).catch(()=>{});if(await back.isVisible())await back.click(); };
      await dismissFirstUse();
      const entry = page.getByRole('button',{name:'查看记忆',exact:true}); await entry.waitFor(); await entry.click();
      const panel = page.getByRole('dialog',{name:'Mochi 记住了什么',exact:true}); await panel.waitFor();
      if (mode === 'observations') {
        const fixtures = [
          {sessionId:'fixture-session-1',messageId:'fixture-message-1',text:'帮我生成 Word 文件作为今天的练习材料'},
          {sessionId:'fixture-session-1',messageId:'fixture-message-2',text:'请输出 Word 格式的课堂讲义'},
          {sessionId:'fixture-session-2',messageId:'fixture-message-3',text:'我需要 Word 文件来整理下周的课程安排'},
        ];
        const store = createStore(openStore(defaultDbPath(home))), proactive = new ProactiveMemory(store,{role:'teacher'});
        const seed = fixture => proactive.capture({id:fixture.sessionId},{type:'user/message',data:{id:fixture.messageId,role:'user',source:{kind:'user'},content:[{type:'text',text:fixture.text}]}});
        try {
          seed(fixtures[0]);
          await panel.getByRole('button',{name:'关闭',exact:true}).click(); await entry.click(); await panel.waitFor();
          const details = panel.locator('details').filter({hasText:'Mochi 正在了解什么'});
          await details.locator('summary').click();
          await details.getByText('选择 Word 作为交付文件格式。',{exact:true}).waitFor();
          await details.getByText('还在观察 · ',{exact:true}).waitFor();
          await details.getByText(fixtures[0].text,{exact:true}).waitFor();
          assert.equal(store.stats().active,0,'one temporary choice stays an observation');
          assert.doesNotMatch(await details.innerText(),/经常|总是/,'one choice has a neutral summary');
          seed(fixtures[1]);
          const third = fixtures[2]; proactive.observe(localObservations(third.text)[0],third);
          assert.equal(proactive.snapshot().habits[0].state,'learned'); assert.equal(store.recall('Word').memories.length,1);
          await page.reload(); await dismissFirstUse(); await entry.click(); await panel.waitFor();
          const refreshed = panel.locator('details').filter({hasText:'Mochi 正在了解什么'});
          await refreshed.locator('summary').click();
          await refreshed.getByText('选择 Word 作为交付文件格式。',{exact:true}).waitFor();
          await refreshed.getByText('已形成暂定习惯 · ',{exact:true}).waitFor();
          await refreshed.getByText('3 条近期依据',{exact:true}).waitFor();
          for (const fixture of fixtures) await refreshed.getByText(fixture.text,{exact:true}).waitFor();
          await panel.getByText('暂定习惯（来自多次对话，仍可修正）：选择 Word 作为交付文件格式。',{exact:true}).waitFor();
          await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(880,720));
          await page.screenshot({path:join(output,'teacher-memory-observations.png')});
          const before = await page.evaluate(async()=>await(await fetch('/api/mochi-memory/state')).json());
          assert.equal(before.learning.habits.length,1); assert.equal(before.learning.habits[0].evidence.length,3);
          assert.equal(new Set(before.learning.habits[0].evidence.map(row=>row.session_id)).size,2);
          await refreshed.getByRole('button',{name:'不要这样记',exact:true}).click();
          await page.waitForFunction(async()=>{const state=await(await fetch('/api/mochi-memory/state')).json();return state.learning.habits.length===0&&state.stats.active===0;});
          await refreshed.waitFor({state:'hidden'});
          assert.deepEqual(store.recall('Word').memories,[],'dismissed observed preference leaves real memory retrieval');
          assert.equal(proactive.snapshot().habits.length,0);
          seed({sessionId:'fixture-session-3',messageId:'fixture-message-4',text:fixtures[0].text});
          assert.equal(proactive.snapshot().habits.length,0,'same dismissed choice does not immediately return');
          const after = await page.evaluate(async()=>await(await fetch('/api/mochi-memory/state')).json());
          assert.deepEqual(errors,[]);
          results.push({role,completeProfile:true,fixtureEvidence:true,realSessionEvents:false,firstChoiceObserving:true,neutralChineseSummary:true,quoteEvidenceCount:3,sessionCount:2,tentativeHabit:true,dismissed:true,retrievalHitsAfter:0,doesNotImmediatelyRelearn:true,before:before.learning,after:after.learning,errors});
          console.log('PASS: teacher observation summary / exact quotes / tentative state / dismiss / real retrieval removal');
        } finally { store.db.close(); }
        continue;
      }
      const learning = panel.getByRole('checkbox',{name:'从日常对话中主动了解我',exact:true}); await learning.waitFor(); assert.equal(await learning.isChecked(),true);
      await learning.click(); await page.waitForFunction(async()=>!(await(await fetch('/api/mochi-memory/state')).json()).learning.enabled);
      await panel.getByRole('button',{name:'关闭',exact:true}).click(); await panel.waitFor({state:'hidden'});
      assert.equal(await entry.evaluate(node=>document.activeElement===node),true,'close returns focus to entry');
      await page.reload(); await dismissFirstUse(); await entry.click(); await panel.waitFor(); assert.equal(await learning.isChecked(),false,'reload preserves disabled learning');
      await learning.click(); await page.waitForFunction(async()=>(await(await fetch('/api/mochi-memory/state')).json()).learning.enabled);
      const initial = await page.evaluate(async()=>await(await fetch('/api/mochi-memory/state')).json()); assert.equal(initial.stats.active,0,'roles have isolated fresh stores');
      const original = `长期资料默认使用 Word 格式（${role}测试）。`, corrected = `长期资料默认使用 PDF 格式（${role}测试）。`;
      await panel.getByRole('button',{name:'记住一件事',exact:true}).click(); await panel.getByRole('textbox',{name:'记忆内容',exact:true}).fill(original);
      await panel.getByRole('button',{name:'保存记忆',exact:true}).click();
      let row = panel.locator('li').filter({hasText:original}); await row.waitFor(); await row.getByRole('button',{name:'固定',exact:true}).click();
      await row.getByRole('button',{name:'取消固定',exact:true}).waitFor();
      await row.getByRole('button',{name:'更正',exact:true}).click(); await panel.getByRole('textbox',{name:'记忆内容',exact:true}).fill(corrected); await panel.getByRole('button',{name:'保存记忆',exact:true}).click();
      row = panel.locator('li').filter({hasText:corrected}); await row.waitFor(); assert.equal(await row.getByRole('button',{name:'取消固定',exact:true}).count(),1,'correction preserves fixed status');
      await panel.getByRole('textbox',{name:'搜索记忆',exact:true}).fill('不存在的记忆条目'); await panel.getByText('没有找到相符的记忆。',{exact:true}).waitFor();
      await panel.getByRole('textbox',{name:'搜索记忆',exact:true}).fill(''); await row.waitFor();
      await panel.getByRole('button',{name:'关闭',exact:true}).click(); await panel.waitFor({state:'hidden'});
      await stop(); const restarted = await start(); await page.goto(restarted); await dismissFirstUse(); await entry.click(); await panel.waitFor();
      assert.equal(await learning.isChecked(),true,'Host restart preserves learning'); row = panel.locator('li').filter({hasText:corrected}); await row.waitFor();
      assert.equal(await row.getByRole('button',{name:'取消固定',exact:true}).count(),1,'Host restart preserves corrected fixed memory');
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(880,720));
      const layout = await panel.evaluate(node=>({width:innerWidth,panelWidth:node.getBoundingClientRect().width,panelOverflow:node.scrollWidth-node.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth}));
      assert.equal(layout.width,880); assert.ok(layout.panelOverflow<=1 && layout.documentOverflow<=1,JSON.stringify(layout));
      await page.screenshot({path:join(output,`${role}-memory-880.png`)});
      await row.getByRole('button',{name:'忘记',exact:true}).click(); await panel.getByText('确定让 Mochi 忘记这条吗？',{exact:true}).waitFor();
      assert.equal(await page.evaluate(async()=>(await(await fetch('/api/mochi-memory/state')).json()).stats.active),1,'forget waits for explicit confirmation');
      await panel.getByRole('button',{name:'保留',exact:true}).click(); await row.waitFor();
      await row.getByRole('button',{name:'忘记',exact:true}).click(); await panel.getByRole('button',{name:'确认忘记',exact:true}).click(); await row.waitFor({state:'hidden'});
      const final = await page.evaluate(async()=>await(await fetch('/api/mochi-memory/state')).json()); assert.equal(final.stats.active,0);
      await page.keyboard.press('Escape'); await panel.waitFor({state:'hidden'}); assert.equal(await entry.evaluate(node=>document.activeElement===node),true,'Escape returns focus');
      const event = await page.evaluate(()=>{const event=new Event('mochi-open-memory',{cancelable:true});const dispatched=window.dispatchEvent(event);return {dispatched,defaultPrevented:event.defaultPrevented};});
      assert.deepEqual(event,{dispatched:false,defaultPrevented:true}); await panel.waitFor();
      await panel.getByRole('button',{name:'关闭',exact:true}).click(); await panel.waitFor({state:'hidden'});
      assert.deepEqual(errors,[]);
      results.push({role,completeProfile:true,learningToggle:true,pageReload:true,hostRestart:true,createCorrectPinForget:true,confirmedForget:true,search:true,focusRestored:true,cancelableEventHandled:true,layout,final:final.stats,errors});
      console.log(`PASS: ${role} full profile memory UI CRUD / learning / restart / focus / cancelable event / 880px`);
    } catch(error) { if(page){await page.screenshot({path:join(output,`${role}-memory-failure.png`)}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-3000));} throw error; }
    finally { await app?.close().catch(()=>{}); await stop(); }
  }
  writeFileSync(join(output,mode === 'observations' ? 'memory-observations-checkpoints.json' : 'memory-ui-checkpoints.json'),JSON.stringify(results,null,2));
} finally { rmSync(root,{recursive:true,force:true}); }
