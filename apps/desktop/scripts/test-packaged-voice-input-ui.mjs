#!/usr/bin/env node
// Synthetic microphone only. The official recorder, WAV encoder and local ASR are real.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {createHash} from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const [appPath, wavePath, role, outputPath] = process.argv.slice(2);
assert.ok(appPath && wavePath && ['teacher','classroom'].includes(role) && outputPath,
 'Usage: node test-packaged-voice-input-ui.mjs <Mochi.app> <Chinese-wav> <teacher|classroom> <evidence-dir>');
const binary=join(resolve(appPath),'Contents/MacOS/Mochi'),resources=join(resolve(appPath),'Contents/Resources/mochi');
const output=resolve(outputPath),root=mkdtempSync(join(tmpdir(),'mochi-packaged-voice-')),home=join(root,'home');
mkdirSync(home,{recursive:true});mkdirSync(output,{recursive:true});
// Bind the empty test home through the shipped provisioner before importing cache.
// Classroom correctly rejects a nonempty unbound home to preserve role isolation.
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role:role,
 resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
cpSync('/tmp/mochi-harness-020-probe/debug-v3/speech-to-text/sensevoice/models',join(home,'speech-to-text/sensevoice/models'),{recursive:true});
const manifestSha256=createHash('sha256').update(readFileSync(join(resources,'package-integrity.json'))).digest('hex');
let app, page, log='',passed=false;
try {
  app = await _electron.launch({ executablePath:binary,args:['--role='+role,'--no-sandbox',`--user-data-dir=${root}/profile`],
    env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',LANG:'zh_CN.UTF-8'}});
  for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',chunk=>{log=(log+chunk).slice(-10000)});
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){page=app.windows().find(window=>/^https?:/.test(window.url()));if(page)break;await new Promise(done=>setTimeout(done,100));}
  if(!page){const windows=app.windows();const snapshots=[];for(const window of windows){snapshots.push({url:window.url().replace(/token=[^&\s]+/g,'token=[redacted]'),body:await window.locator('body').innerText().catch(()=>'' )});await window.screenshot({path:join(output,'startup-window-'+snapshots.length+'.png')}).catch(()=>{});}writeFileSync(join(output,'startup-diagnostics.json'),JSON.stringify({snapshots,main:await app.evaluate(({app,BrowserWindow})=>({argv:process.argv,role:process.env.MOCHI_RUNTIME_ROLE,packaged:app.isPackaged,windows:BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),url:w.webContents.getURL().replace(/token=[^&\s]+/g,'token=[redacted]')}))})),log:log.replace(/token=\S+/g,'token=[redacted]')},null,2));}
  assert.ok(page,'Actual packaged Host main window');
  const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged}));
  assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
  const errors = [], transcripts = [], submissions = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /session\/(prompt|beginSubmission)/u.test(request.url())) submissions.push(new URL(request.url()).pathname);
  });
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/speech/transcribe') {
      const data = await response.json();
      transcripts.push(data.result);
    }
  });
  await app.context().addInitScript(base64 => {
    window.__voiceFixture = { tracks: [], mode: 'speech' };
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio || constraints.video) throw Error('Only synthetic microphone audio is available');
      if (window.__voiceFixture.mode === 'denied') throw new DOMException('Test microphone denied', 'NotAllowedError');
      const context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const source = context.createBufferSource();
      source.buffer = await context.decodeAudioData(bytes.buffer);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      source.start();
      let stopped = false;
      for (const track of destination.stream.getTracks()) {
        window.__voiceFixture.tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          if (stopped) return;
          stopped = true;
          source.stop();
          void context.close();
        };
      }
      return destination.stream;
    };
  }, readFileSync(wavePath).toString('base64'));
  await page.waitForTimeout(5000);
  await page.reload();
  await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:60000});
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
    await page.waitForTimeout(300);
  }
  const address=page.locator('[data-mochi-user-address=true]');
  if(await address.isVisible()){await address.fill(role==='teacher'?'包内语音验收老师':'包内语音验收班');await page.getByRole('button',{name:'保存称呼',exact:true}).click();await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();}
  for(let i=0;i<7;i++){const next=page.getByRole('button',{name:'我了解了，下一步',exact:true});if(await next.isVisible()){await next.click();await page.waitForTimeout(80);}}
  const finish=page.getByRole('button',{name:'完成指引',exact:true});if(await finish.isVisible())await finish.click();
  const workspace = page.getByText('选择工作区', { exact: true });
  if (await workspace.isVisible()) {
    await workspace.click();
    await page.getByRole('menuitem', { name: '默认工作区', exact: true }).click();
  }
  // Preparation is managed upstream; the test reuses already downloaded, hash-verified models.
  const guide = page.getByRole('button', { name: '打开语音输入引导', exact: true });
  if (await guide.isVisible()) {
    await guide.click();
    await page.getByRole('button', { name: '前往安装', exact: true }).click();
    await page.getByRole('button', { name: '下载并准备', exact: true }).click();
    await page.getByText(/本地资源已准备|本地语音已就绪/u).first().waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '新建会话', exact: true }).last().click();
  }
  const start = page.getByRole('button', { name: '开始录音', exact: true });
  await start.waitFor({ state: 'visible', timeout: 20000 });
  // Listening has its own integration test; keep this check scoped to dictation tracks.
  await page.evaluate(() => window.mochiClassroomListening?.pause('input-test'));
  const editor = page.locator('[contenteditable=true]').first();
  await editor.fill('给老师的小草稿：');
  await start.click();
  await page.getByRole('button', { name: '停止并识别', exact: true }).waitFor();
  await page.screenshot({ path: join(output, `${role}-voice-recording.png`) });
  await page.waitForTimeout(5000);
  const transcribed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/speech/transcribe');
  await page.getByRole('button', { name: '停止并识别', exact: true }).click();
  await transcribed;
  await page.waitForFunction(() => document.querySelector('[contenteditable=true]')?.textContent?.includes('数学课本'));
  const draft = await editor.innerText();
  assert.match(draft, /给老师的小草稿/);
  assert.match(draft, /数学课本第(?:20|二十)页/);
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].ok, true);
  assert.ok(transcripts[0].value.audioSeconds > 3);
  assert.ok(await page.evaluate(() => window.__voiceFixture.tracks.every(track => track.readyState === 'ended')));
  await editor.fill(`${draft}\n请核对后发送。`);
  assert.match(await editor.innerText(), /请核对后发送/);
  const styles = await start.evaluate(button => ({ label: getComputedStyle(button, '::after').content,
    bridge: !!document.getElementById('jxl-theme-bridge'), palette: document.documentElement.dataset.mochiPetPalette }));
  assert.equal(styles.bridge, true);
  assert.match(styles.label, /语音输入/);
  await page.screenshot({ path: join(output, `${role}-voice-draft.png`) });
  const preserved = await editor.innerText();
  await start.click();
  await page.getByRole('button', { name: '停止并识别', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await start.waitFor();
  assert.equal(await editor.innerText(), preserved);
  assert.equal(transcripts.length, 1, 'Cancellation must not transcribe');
  await page.evaluate(() => { window.__voiceFixture.mode = 'denied'; });
  await start.click();
  await page.getByText('麦克风权限未开启，请在浏览器和系统设置中允许访问。', { exact: true }).waitFor();
  assert.equal(await editor.innerText(), preserved);
  assert.equal(transcripts.length, 1, 'Denied microphone must not transcribe');
  assert.deepEqual(submissions, [], 'Voice input must never submit a conversation');
  assert.ok(await page.evaluate(() => window.__voiceFixture.tracks.every(track => track.readyState === 'ended')));
  assert.deepEqual(errors, []);
  writeFileSync(join(output, `${role}-voice-checkpoints.json`), JSON.stringify({ role,runtime,manifestSha256,actualPackagedAppMain:true,source: 'synthetic WebAudio microphone; real upstream recorder and SenseVoice ASR',
    physicalMicrophoneVerified: false, draft, styles, transcripts, noAutoSend: submissions.length === 0,
    editable: true, cancelPreservesDraft: true, deniedPermissionPreservesDraft: true, tracksReleased: true, errors }, null, 2));
  passed=true;
  console.log(`PASS ${role}: synthetic microphone → official recorder → real local ASR → editable draft; cancel and no auto-send`);
} catch (error) {
  console.error(log.replace(/token=\S+/g,'token=[redacted]').slice(-5000));
  if (page) {
    await page.screenshot({ path: join(output, `${role}-voice-failure.png`) }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(-3500));
  }
  throw error;
} finally {
  await app?.close();
  if(passed)rmSync(root,{recursive:true,force:true});else console.error('Test-only diagnostics directory retained: '+root);
}
