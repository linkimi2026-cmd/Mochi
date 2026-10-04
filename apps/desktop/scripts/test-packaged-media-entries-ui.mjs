#!/usr/bin/env node
// Real packaged App media entry styles and controls, with a synthetic video source.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{_electron}=require('playwright');
const [appPath,role,outputPath]=process.argv.slice(2);
assert.ok(appPath&&['teacher','classroom'].includes(role)&&outputPath,'Pass actual Mochi.app, role and evidence dir');
const resources=join(resolve(appPath),'Contents/Resources/mochi'),binary=join(resolve(appPath),'Contents/MacOS/Mochi');
const output=resolve(outputPath),root=mkdtempSync(join(tmpdir(),'mochi-packaged-camera-')),home=join(root,'home');
mkdirSync(home,{recursive:true});mkdirSync(output,{recursive:true});
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role,resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
cpSync('/tmp/mochi-harness-020-probe/debug-v3/speech-to-text/sensevoice/models',join(home,'speech-to-text/sensevoice/models'),{recursive:true});
const manifestSha256=createHash('sha256').update(readFileSync(join(resources,'package-integrity.json'))).digest('hex');
const resourceSha256=Object.fromEntries(['mochi-camera/index.mjs', 'mochi-camera/projection.mjs', 'mochi-camera-client/client.js', 'mochi-voice-chat/client.js', 'mochi-classroom-assistant-client/client.js'].map(file=>[file,createHash('sha256').update(readFileSync(join(resources,'plugins',file))).digest('hex')]));
const requests=[],reply='题目图片已到达本机测试网关。';
const gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 const images=body.messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(block=>block.type==='image_url'):[]),result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='camera-fixture-call');
 const hasCameraTool=body.tools?.some(tool=>tool.function?.name==='mochi_open_camera')||false;
 requests.push({images:images.map(image=>({jpeg:image.image_url.url.startsWith('data:image/jpeg;base64,'),bytes:image.image_url.url.length})),hasCameraTool,hasToolResult:!!result});
 const delta={role:'assistant',content:reply};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`)});
await new Promise(done=>gateway.listen(0,'127.0.0.1',done));
// A test user's explicit, valid local-model settings; the App migrates them normally.
writeFileSync(join(home,'settings.yaml'),`agent-default-model:\n  provider: voicechat-fixture\n  model: fixture-model\nllm-pi-ai:\n  providers:\n    voicechat-fixture:\n      api: openai-completions\n      apiKeyEnv: VOICECHAT_FIXTURE_KEY\n      baseURL: http://127.0.0.1:${gateway.address().port}/v1\n      models:\n        - id: fixture-model\n          name: Local camera fixture\n          input: [text, image]\n          contextWindow: 262144\n          maxTokens: 4096\n`);
let app,page,passed=false;
try{
 app=await _electron.launch({executablePath:binary,args:['--role='+role,'--no-sandbox','--user-data-dir='+join(root,'profile')],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',LANG:'zh_CN.UTF-8',VOICECHAT_FIXTURE_KEY:'test-only-not-a-real-key'}});
 const deadline=Date.now()+60000;while(Date.now()<deadline){page=app.windows().find(p=>/^http:/.test(p.url()));if(page)break;await new Promise(done=>setTimeout(done,100));}assert.ok(page,'Actual App Host');
 const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged}));assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let entryChecks=null;
 await app.context().addInitScript(()=>{
  window.__cameras=[];window.__microphones=[];
  navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'test-front',groupId:'test',label:'Synthetic camera A'},{kind:'videoinput',deviceId:'test-document',groupId:'test',label:'Synthetic camera B'}];
  navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints.audio&&!constraints.video){const context=new AudioContext({sampleRate:16000});await context.resume();const destination=context.createMediaStreamDestination();const record={context,stopped:false};window.__microphones.push(record);for(const track of destination.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stop();record.stopped=true;void context.close()}}return destination.stream}if(constraints.audio!==false||!constraints.video)throw Error('Video-only synthetic source');const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');let frame=0;const draw=()=>{context.fillStyle=constraints.video.deviceId?.exact==='test-document'?'#8fa191':'#c29b68';context.fillRect(0,0,640,480);context.fillStyle='#fffdf8';context.font='32px sans-serif';context.fillText('Synthetic question image '+frame++,40,200)};draw();const timer=setInterval(draw,100),stream=canvas.captureStream(10),track=stream.getVideoTracks()[0],stop=track.stop.bind(track),settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:constraints.video.deviceId?.exact||'test-front'});track.stop=()=>{stop();clearInterval(timer)};window.__cameras.push(track);return stream};
 });
 await page.waitForTimeout(5000);await page.reload();await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'继续',exact:true}).click();
 await page.waitForTimeout(600);
  const deferProfile=page.getByRole('button',{name:'稍后设置',exact:true});
  await deferProfile.waitFor({timeout:15000});await deferProfile.click();
  const closeMailbox=page.getByRole('button',{name:'关闭小信箱',exact:true});
  if(await closeMailbox.isVisible())await closeMailbox.click();else await page.keyboard.press('Escape');
 await page.getByText('Local camera fixture',{exact:true}).first().waitFor({state:'attached'});
 const preparation=page.getByRole('button',{name:'打开语音输入引导',exact:true});if(await preparation.isVisible()){await preparation.click();await page.getByRole('button',{name:'前往安装',exact:true}).click();await page.getByRole('button',{name:'下载并准备',exact:true}).click();await page.getByText(/本地资源已准备|本地语音已就绪/).first().waitFor({timeout:60000});await page.getByRole('button',{name:'新建会话',exact:true}).last().click()}
 const composer=page.locator('[data-composer-input="true"]').filter({visible:true}).last();await composer.fill('Please show the local media entry fixture');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText(reply,{exact:true}).last().waitFor();
 await page.getByRole('button',{name:'摄像头或展台拍题',exact:true}).click();const panel=page.getByRole('dialog',{name:'摄像头 / 展台拍题',exact:true});await panel.waitFor();await page.waitForFunction(()=>document.querySelector('.mochi-camera__video')?.videoWidth>0,null,{polling:100});await page.screenshot({path:join(output,role+'-camera-shell.png')});await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
 let listenerChecks=null;
 if(role==='classroom'){
  const listener=page.locator('button[data-mochi-classroom-status]');await listener.waitFor();
  if(await listener.getAttribute('data-wide')==='true'){await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await page.locator('button[data-mochi-classroom-status][data-wide="false"]').waitFor();await page.waitForTimeout(350)}
  const measure=()=>listener.evaluate(n=>{const r=n.getBoundingClientRect(),slot=n.closest('[data-slot="sidebar"]'),root=[...slot.children].find(c=>c.contains(n)&&c.getBoundingClientRect().width>0),bounds=root.getBoundingClientRect(),s=getComputedStyle(n);return{wide:n.dataset.wide,x:r.x,right:r.right,width:r.width,height:r.height,sidebarX:bounds.x,sidebarRight:bounds.right,text:n.textContent,icon:!!n.querySelector('svg'),border:s.borderWidth}});
  const rail=await measure();assert.equal(rail.wide,'false');assert.equal(rail.text,'');assert.equal(rail.width,36);assert.equal(rail.border,'0px');assert.equal(rail.icon,true);assert.ok(rail.x>=rail.sidebarX&&rail.right<=rail.sidebarRight);
  await listener.hover();await page.getByRole('tooltip').filter({hasText:'课堂助手'}).waitFor();await page.mouse.move(400,40);
  await listener.click();const assistant=page.getByRole('dialog',{name:'课堂助手',exact:true});await assistant.waitFor();
  const prepare=assistant.getByRole('button',{name:'准备本地识别模型',exact:true});if(await prepare.isVisible())await prepare.click();
  await page.waitForFunction(()=>window.mochiClassroomListening.snapshot().state==='listening',null,{timeout:60000,polling:100});
  await assistant.getByRole('button',{name:'暂停监听',exact:true}).click();await page.waitForFunction(()=>window.mochiClassroomListening.snapshot().state==='paused',null,{polling:100});
  await assistant.getByRole('button',{name:'开启监听',exact:true}).click();await page.waitForFunction(()=>window.mochiClassroomListening.snapshot().state==='listening',null,{polling:100});
  await assistant.getByRole('button',{name:'暂停监听',exact:true}).click();await assistant.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'打开侧边栏',exact:true}).click();await page.waitForTimeout(350);const wide=await measure();assert.equal(wide.wide,'true');assert.ok(wide.text);assert.equal(wide.border,'0px');assert.ok(wide.x>=wide.sidebarX&&wide.right<=wide.sidebarRight);listenerChecks={rail,wide,opensActualAssistant:true,pauseResume:true,tooltip:true};
 }
 const voice=page.getByRole('button',{name:'开启语音对话',exact:true});await voice.waitFor();
 const voiceStyle=await voice.evaluate(n=>({border:getComputedStyle(n).borderWidth,height:n.getBoundingClientRect().height,icon:!!n.querySelector('svg')}));assert.equal(voiceStyle.border,'0px');assert.equal(voiceStyle.height,28);assert.equal(voiceStyle.icon,true);
 await voice.hover();await page.getByRole('tooltip').filter({hasText:'显式开启后'}).waitFor();await page.mouse.move(400,40);
 await voice.click();const stopVoice=page.getByRole('button',{name:'结束语音对话',exact:true});await stopVoice.waitFor();assert.equal(await stopVoice.getAttribute('aria-pressed'),'true');
 await page.locator('[data-mochi-voice-chat="listening"]').waitFor();await stopVoice.click();await voice.waitFor();assert.equal(await voice.getAttribute('aria-pressed'),'false');assert.ok(await page.evaluate(()=>window.__microphones.every(m=>m.stopped)));
 await page.screenshot({path:join(output,role+'-entry-controls.png')});assert.deepEqual(errors,[]);
 writeFileSync(join(output,role+'-entry-checkpoints.json'),JSON.stringify({role,runtime,manifestSha256,resourceSha256,testedAt:new Date().toISOString(),actualPackagedAppMain:true,syntheticMedia:true,physicalHardwareVerified:false,paidModel:false,voiceStyle,voiceTooltip:true,explicitVoiceStartStop:true,allAudioTracksReleased:true,listenerChecks,cameraShellOpened:true,cameraEscapeClosesPanel:true,errors},null,2)+'\n');passed=true;console.log('PASS '+role+' actual packaged entry controls and camera shell');
}catch(error){for(const [i,p] of (app?.windows()||[]).entries()){await p.screenshot({path:join(output,'failure-'+i+'.png')}).catch(()=>{});if(/^http:/.test(p.url()))console.error((await p.locator('body').innerText()).slice(-3500))}throw error}
finally{await app?.close();await new Promise(done=>gateway.close(done));if(passed)rmSync(root,{recursive:true,force:true});else console.error('Test-only diagnostics directory retained: '+root)}
