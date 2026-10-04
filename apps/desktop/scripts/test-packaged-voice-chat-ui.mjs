#!/usr/bin/env node
// Real packaged App, official ASR/Session, loopback model fixture, actual native reply IPC.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{_electron}=require('playwright');
const [appPath,wavePath,role,outputPath]=process.argv.slice(2);
assert.ok(appPath&&wavePath&&['teacher','classroom'].includes(role)&&outputPath,'Pass Mochi.app, WAV, role and evidence dir');
const resources=join(resolve(appPath),'Contents/Resources/mochi'),binary=join(resolve(appPath),'Contents/MacOS/Mochi');
const output=resolve(outputPath),root=mkdtempSync(join(tmpdir(),'mochi-packaged-voicechat-')),home=join(root,'home');
mkdirSync(home,{recursive:true});mkdirSync(output,{recursive:true});
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role,resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
cpSync('/tmp/mochi-harness-020-probe/debug-v3/speech-to-text/sensevoice/models',join(home,'speech-to-text/sensevoice/models'),{recursive:true});
const manifestSha256=createHash('sha256').update(readFileSync(join(resources,'package-integrity.json'))).digest('hex');
const requests=[],reply='这是本地语音测试回答，没有调用付费模型。'.repeat(35);
const gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push({path:req.url,user:body.messages.findLast(message=>message.role==='user')?.content});res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:reply},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`)});
await new Promise(done=>gateway.listen(0,'127.0.0.1',done));
// A test user's explicit, valid local-model settings; the App migrates them normally.
writeFileSync(join(home,'settings.yaml'),`agent-default-model:\n  provider: voicechat-fixture\n  model: fixture-model\nllm-pi-ai:\n  providers:\n    voicechat-fixture:\n      api: openai-completions\n      apiKeyEnv: VOICECHAT_FIXTURE_KEY\n      baseURL: http://127.0.0.1:${gateway.address().port}/v1\n      models:\n        - id: fixture-model\n          name: Local voice fixture\n          input: [text]\n          contextWindow: 262144\n          maxTokens: 4096\n`);
let app,page,passed=false;
try{
 app=await _electron.launch({executablePath:binary,args:['--role='+role,'--no-sandbox','--user-data-dir='+join(root,'profile')],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',LANG:'zh_CN.UTF-8',VOICECHAT_FIXTURE_KEY:'test-only-not-a-real-key'}});
 const deadline=Date.now()+60000;while(Date.now()<deadline){page=app.windows().find(p=>/^http:/.test(p.url()));if(page)break;await new Promise(done=>setTimeout(done,100));}assert.ok(page,'Actual App Host');
 const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged}));assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
 const errors=[],transcripts=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/speech/transcribe')transcripts.push((await response.json()).result)});
 await app.context().addInitScript(()=>{
  window.__mics=[];
  navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints.audio||constraints.video)throw Error('Synthetic audio only');const context=new AudioContext({sampleRate:16000});await context.resume();const destination=context.createMediaStreamDestination(),record={context,destination,stopped:false};window.__mics.push(record);for(const track of destination.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stop();record.stopped=true;void context.close()}}return destination.stream};
  window.__play=async audio=>{const record=window.__mics.findLast(item=>!item.stopped);assertMic(record);const source=record.context.createBufferSource();source.buffer=await record.context.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);source.connect(record.destination);await new Promise(done=>{source.onended=done;source.start()})};
  function assertMic(record){if(!record)throw Error('No owned microphone')}
 });
 await page.waitForTimeout(5000);await page.reload();await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'继续',exact:true}).click();
 await page.waitForTimeout(600);
  const deferProfile=page.getByRole('button',{name:'稍后设置',exact:true});
  await deferProfile.waitFor({timeout:15000});await deferProfile.click();
  const closeMailbox=page.getByRole('button',{name:'关闭小信箱',exact:true});
  if(await closeMailbox.isVisible())await closeMailbox.click();else await page.keyboard.press('Escape');
 const preparation=page.getByRole('button',{name:'打开语音输入引导',exact:true});if(await preparation.isVisible()){await preparation.click();await page.getByRole('button',{name:'前往安装',exact:true}).click();await page.getByRole('button',{name:'下载并准备',exact:true}).click();await page.getByText(/本地资源已准备|本地语音已就绪/).first().waitFor({timeout:60000});await page.getByRole('button',{name:'新建会话',exact:true}).last().click()}
 await page.evaluate(()=>window.mochiClassroomListening?.pause('voicechat-fixture-isolation'));
 // Verify the explicit local route before sending anything, so no paid endpoint can run.
 await page.getByText('Local voice fixture',{exact:true}).first().waitFor({state:'attached'});
 const composer=page.locator('[data-composer-input="true"]').filter({visible:true}).last();await composer.fill('Seed local voice fixture');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText(reply,{exact:true}).last().waitFor({timeout:30000});
 const sessionId=await page.locator('[data-conversation-content]').getAttribute('data-conversation-session');assert.ok(sessionId);
 const entry=page.getByRole('button',{name:'开启语音对话',exact:true});await entry.waitFor();assert.equal(await entry.getAttribute('aria-pressed'),'false');
 await composer.fill('Keep this unsent draft');const before=requests.length;await entry.click();await page.locator('[data-mochi-voice-chat="listening"]').waitFor();assert.equal(await page.evaluate(()=>window.__mics.filter(m=>!m.stopped).length),1);
 await page.evaluate(audio=>window.__play(audio),readFileSync(wavePath).toString('base64'));await page.locator('[data-mochi-voice-chat="speaking"]').waitFor({timeout:30000});
 assert.equal(await page.evaluate(()=>window.__mics.filter(m=>!m.stopped).length),0);assert.equal(await composer.innerText(),'Keep this unsent draft');assert.equal(await page.locator('[data-conversation-content]').getAttribute('data-conversation-session'),sessionId);
 assert.match(JSON.stringify(requests.slice(before)),/数学课本第(?:20|二十)页/);assert.ok(transcripts.some(r=>r.ok&&r.value.text.includes('数学课本')));
 const speakerDeadline=Date.now()+3000;let nativeSay=false;while(Date.now()<speakerDeadline){nativeSay=execFileSync('ps',['-axo','ppid,command'],{encoding:'utf8'}).split('\n').some(line=>Number(line.trim().split(/\s+/)[0])===app.process().pid&&line.includes('/usr/bin/say'));if(nativeSay)break;await page.waitForTimeout(50)}assert.ok(nativeSay,'Actual App spawned the native say process');
 await page.getByRole('button',{name:'打断并继续听',exact:true}).click();await page.locator('[data-mochi-voice-chat="listening"]').waitFor();await page.getByRole('button',{name:'结束语音对话',exact:true}).click();assert.equal(await entry.getAttribute('aria-pressed'),'false');assert.ok(await page.evaluate(()=>window.__mics.every(m=>m.stopped)));assert.deepEqual(errors,[]);
 await page.screenshot({path:join(output,role+'-voice-chat.png')});writeFileSync(join(output,role+'-voice-chat-checkpoints.json'),JSON.stringify({role,runtime,manifestSha256,actualPackagedAppMain:true,syntheticMicrophone:true,physicalMicrophoneVerified:false,physicalSpeakerVerified:false,localModelFixture:true,paidModel:false,sessionId,defaultOff:true,realAsr:true,transcripts,currentSession:true,draftPreserved:true,microphoneClosedDuringSpeech:true,actualNativeSayProcess:true,interruptReturnsToListening:true,stopReleasesTracks:true,requests:requests.slice(before),errors},null,2)+'\n');passed=true;console.log('PASS '+role+' actual packaged voice chat: ASR/current Session/local reply/native say/cancel');
}catch(error){for(const [i,p] of (app?.windows()||[]).entries()){await p.screenshot({path:join(output,'failure-'+i+'.png')}).catch(()=>{});if(/^http:/.test(p.url()))console.error((await p.locator('body').innerText()).slice(-3500))}throw error}
finally{await app?.close();await new Promise(done=>gateway.close(done));if(passed)rmSync(root,{recursive:true,force:true});else console.error('Test-only diagnostics directory retained: '+root)}
