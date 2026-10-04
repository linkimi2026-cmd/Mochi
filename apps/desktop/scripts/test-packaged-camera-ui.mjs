#!/usr/bin/env node
// Real packaged App camera tool/preview/draft/send, with a synthetic video source.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{_electron}=require('playwright');
const [appPath,role,outputPath]=process.argv.slice(2);
assert.ok(appPath&&['teacher','classroom'].includes(role)&&outputPath,'Pass actual Mochi.app, role and evidence dir');
const resources=join(resolve(appPath),'Contents/Resources/mochi'),binary=join(resolve(appPath),'Contents/MacOS/Mochi');
const output=resolve(outputPath),root=mkdtempSync(join(tmpdir(),'mochi-packaged-camera-')),home=join(root,'home');
mkdirSync(home,{recursive:true});mkdirSync(output,{recursive:true});
require(join(resources,'profile/runtime-profile.cjs')).provisionMochiProfiles({homeDir:home,role,resourceRoot:join(resources,'profile'),skillsDir:join(resources,'skills'),pluginRoot:join(resources,'plugins'),runtimeNodeModulesRoot:join(resources,'node_modules')});
const manifestSha256=createHash('sha256').update(readFileSync(join(resources,'package-integrity.json'))).digest('hex');
const resourceSha256=Object.fromEntries(['mochi-camera/index.mjs', 'mochi-camera/projection.mjs', 'mochi-camera-client/client.js', 'mochi-voice-chat/client.js', 'mochi-classroom-assistant-client/client.js'].map(file=>[file,createHash('sha256').update(readFileSync(join(resources,'plugins',file))).digest('hex')]));
const requests=[],reply='题目图片已到达本机测试网关。';
const gateway=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 const images=body.messages.flatMap(message=>Array.isArray(message.content)?message.content.filter(block=>block.type==='image_url'):[]),result=body.messages.find(message=>message.role==='tool'&&message.tool_call_id==='camera-fixture-call');
 const hasCameraTool=body.tools?.some(tool=>tool.function?.name==='mochi_open_camera')||false;
 requests.push({images:images.map(image=>({jpeg:image.image_url.url.startsWith('data:image/jpeg;base64,'),bytes:image.image_url.url.length})),hasCameraTool,hasToolResult:!!result});
 const delta=hasCameraTool&&!result&&!images.length?{role:'assistant',tool_calls:[{index:0,id:'camera-fixture-call',type:'function',function:{name:'mochi_open_camera',arguments:'{}'}}]}:{role:'assistant',content:images.length?reply:'请拍照并检查草稿图片。'};
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:delta.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}})}\n\ndata: [DONE]\n\n`)});
await new Promise(done=>gateway.listen(0,'127.0.0.1',done));
// A test user's explicit, valid local-model settings; the App migrates them normally.
writeFileSync(join(home,'settings.yaml'),`agent-default-model:\n  provider: voicechat-fixture\n  model: fixture-model\nllm-pi-ai:\n  providers:\n    voicechat-fixture:\n      api: openai-completions\n      apiKeyEnv: VOICECHAT_FIXTURE_KEY\n      baseURL: http://127.0.0.1:${gateway.address().port}/v1\n      models:\n        - id: fixture-model\n          name: Local camera fixture\n          input: [text, image]\n          contextWindow: 262144\n          maxTokens: 4096\n`);
let app,page,passed=false;
try{
 app=await _electron.launch({executablePath:binary,args:['--role='+role,'--no-sandbox','--user-data-dir='+join(root,'profile')],env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,MOCHI_RUNTIME_HOME:home,MOCHI_DSH_PORT:'0',DSH_TELEMETRY_DISABLED:'1',LANG:'zh_CN.UTF-8',VOICECHAT_FIXTURE_KEY:'test-only-not-a-real-key'}});
 const deadline=Date.now()+60000;while(Date.now()<deadline){page=app.windows().find(p=>/^http:/.test(p.url()));if(page)break;await new Promise(done=>setTimeout(done,100));}assert.ok(page,'Actual App Host');
 const runtime=await app.evaluate(({app})=>({electron:process.versions.electron,node:process.versions.node,packaged:app.isPackaged}));assert.equal(runtime.electron,'44.0.0');assert.equal(runtime.packaged,true);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.context().addInitScript(()=>{
  window.__cameras=[];
  navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'test-front',groupId:'test',label:'Synthetic camera A'},{kind:'videoinput',deviceId:'test-document',groupId:'test',label:'Synthetic camera B'}];
  navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints.audio!==false||!constraints.video)throw Error('Video-only synthetic source');const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');let frame=0;const draw=()=>{context.fillStyle=constraints.video.deviceId?.exact==='test-document'?'#8fa191':'#c29b68';context.fillRect(0,0,640,480);context.fillStyle='#fffdf8';context.font='32px sans-serif';context.fillText('Synthetic question image '+frame++,40,200)};draw();const timer=setInterval(draw,100),stream=canvas.captureStream(10),track=stream.getVideoTracks()[0],stop=track.stop.bind(track),settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:constraints.video.deviceId?.exact||'test-front'});track.stop=()=>{stop();clearInterval(timer)};window.__cameras.push(track);return stream};
 });
 await page.waitForTimeout(5000);await page.reload();await page.getByRole('button',{name:'继续',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'继续',exact:true}).click();
 await page.waitForTimeout(600);
  const deferProfile=page.getByRole('button',{name:'稍后设置',exact:true});
  await deferProfile.waitFor({timeout:15000});await deferProfile.click();
  const closeMailbox=page.getByRole('button',{name:'关闭小信箱',exact:true});
  if(await closeMailbox.isVisible())await closeMailbox.click();else await page.keyboard.press('Escape');
 await page.getByText('Local camera fixture',{exact:true}).first().waitFor({state:'attached'});
 const composer=page.locator('[data-composer-input="true"]').filter({visible:true}).last();await composer.fill('Please open the camera for a question');await page.getByRole('button',{name:'发送消息',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'摄像头 / 展台拍题',exact:true});await panel.waitFor({timeout:30000});await page.waitForFunction(()=>{const v=document.querySelector('.mochi-camera__video');return v?.readyState>=2&&v.videoWidth>0},null,{polling:100});
 const resultDeadline=Date.now()+10000;while(!requests.some(r=>r.hasCameraTool&&r.hasToolResult)&&Date.now()<resultDeadline)await new Promise(done=>setTimeout(done,100));
 assert.ok(requests.some(r=>r.hasCameraTool&&r.hasToolResult),'Real tool schema and result');
 const sessionId=await page.locator('[data-conversation-content]').getAttribute('data-conversation-session');assert.ok(sessionId);
 const media=await page.evaluate(()=>{const v=document.querySelector('.mochi-camera__video');window.__priorCamera=v.srcObject.getVideoTracks()[0];return{width:v.videoWidth,height:v.videoHeight,audio:v.srcObject.getAudioTracks().length,devices:document.querySelector('select[aria-label="视频设备"]').options.length}});assert.equal(media.audio,0);assert.ok(media.devices>=2);
 await page.locator('select[aria-label="视频设备"]').selectOption('test-document');await page.waitForFunction(()=>window.__priorCamera.readyState==='ended'&&document.querySelector('.mochi-camera__video').srcObject?.getVideoTracks()[0].readyState==='live',null,{polling:100});
 assert.equal(await page.locator('select[aria-label="视频设备"]').inputValue(),'test-document');
 await page.screenshot({path:join(output,role+'-camera-preview.png')});await panel.getByRole('button',{name:'拍照并加入草稿',exact:true}).click();await panel.waitFor({state:'hidden'});await page.waitForFunction(()=>window.__cameras.every(t=>t.readyState==='ended'),null,{polling:100});assert.ok(await page.locator('[data-composer-card] img').count());assert.ok(!requests.some(r=>r.images.length),'Capture must not send');await page.screenshot({path:join(output,role+'-camera-draft.png')});
 await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText(reply,{exact:true}).last().waitFor({timeout:30000});assert.ok(requests.some(r=>r.images.some(image=>image.jpeg&&image.bytes>1000)),'Actual model request contains captured JPEG');assert.equal(await page.locator('[data-conversation-content]').getAttribute('data-conversation-session'),sessionId);
 await page.getByRole('button',{name:'摄像头或展台拍题',exact:true}).click();await panel.waitFor();await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>window.__cameras.every(t=>t.readyState==='ended')));
 assert.deepEqual(errors,[]);
 writeFileSync(join(output,role+'-camera-checkpoints.json'),JSON.stringify({role,runtime,manifestSha256,resourceSha256,testedAt:new Date().toISOString(),actualPackagedAppMain:true,syntheticVideo:true,physicalSchoolCameraVerified:false,localModelFixture:true,paidModel:false,sessionId,media,realToolOpensPreview:true,deviceSwitchReleasesTrack:true,captureJpegToOfficialDraft:true,noAutoSend:true,explicitSendCarriesImage:true,currentSession:true,escapeReleasesDevice:true,requests,errors},null,2)+'\n');passed=true;console.log('PASS '+role+' actual packaged camera: tool/preview/JPEG draft/explicit local send');
}catch(error){for(const [i,p] of (app?.windows()||[]).entries()){await p.screenshot({path:join(output,'failure-'+i+'.png')}).catch(()=>{});if(/^http:/.test(p.url()))console.error((await p.locator('body').innerText()).slice(-3500))}throw error}
finally{await app?.close();await new Promise(done=>gateway.close(done));if(passed)rmSync(root,{recursive:true,force:true});else console.error('Test-only diagnostics directory retained: '+root)}
