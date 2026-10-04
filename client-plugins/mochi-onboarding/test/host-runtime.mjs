// Official Host and Electron, real nickname/LAN/config persistence, no model requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,cpSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const role=process.env.MOCHI_GUIDE_ROLE||'teacher';assert.ok(['teacher','classroom'].includes(role));
const address=role==='teacher'?'验收老师':'验收班小伙伴';
const modules=resolve(process.argv[2]||'/tmp/mochi-harness-020-probe/node_modules');
const repo=resolve(import.meta.dirname,'../../..'), req=createRequire(join(repo,'apps/desktop/package.json'));
const {_electron}=req('playwright');
const root=mkdtempSync(join(tmpdir(),'mochi-guide-host-')),home=join(root,'home'),profile=join(home,'profiles/web');
const evidence=resolve(process.env.MOCHI_GUIDE_EVIDENCE_DIR||join(repo,'docs/evidence/harness-upgrade-2026-09-30/onboarding'));
let host,electron,log='';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,label){const end=Date.now()+45000;while(Date.now()<end){const result=await read();if(result)return result;await sleep(100)}throw Error(label+'\n'+log.replace(/token=\S+/g,'token=[redacted]').slice(-3000))}
try{
 mkdirSync(join(profile,'node_modules'),{recursive:true});mkdirSync(evidence,{recursive:true});
 symlinkSync(join(modules,'@deepseek-ai'),join(profile,'node_modules/@deepseek-ai'));
 const plugins=[['mochi-onboarding','client-plugins/mochi-onboarding'],['mochi-user-profile','plugins/mochi-user-profile'],['mochi-lan','plugins/mochi-lan'],['mochi-lan-client','client-plugins/mochi-lan'],['jxl-brand','client-plugins/jxl-brand'],['jxl-theme','client-plugins/jxl-theme'],['mochi-camera-client','client-plugins/mochi-camera']];
 const dependencies={};
 for(const[name,source]of plugins){const target=join(root,name);cpSync(join(repo,source),target,{recursive:true});mkdirSync(join(target,'node_modules'),{recursive:true});symlinkSync(join(modules,'@deepseek-ai'),join(target,'node_modules/@deepseek-ai'));symlinkSync(target,join(profile,'node_modules',name));dependencies[name]='link:'+target}

 writeFileSync(join(profile,'package.json'),JSON.stringify({name:'guide-test',private:true,dependencies,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}}));
 writeFileSync(join(profile,'cordis.yml'),'[]\n');
 writeFileSync(join(profile,'cordis.patch.yml'),`- id: ui-settings-models\n  config: { credentialOnboarding: false }\n- id: ui-brand-official\n  disabled: true\n- insert:\n    - id: mochi-onboarding\n      name: mochi-onboarding\n    - id: mochi-user-profile\n      name: mochi-user-profile\n      config: { role: ${role}, dataRoot: ${JSON.stringify(home)} }\n    - id: mochi-lan\n      name: mochi-lan\n      config: { lockedRole: ${role}, dataRoot: ${JSON.stringify(home)}, bindHost: 127.0.0.1, port: 0, discoveryEnabled: false }\n    - id: mochi-lan-client\n      name: mochi-lan-client\n    - id: jxl-brand\n      name: jxl-brand\n    - id: jxl-theme\n      name: jxl-theme\n    - id: mochi-camera-client\n      name: mochi-camera-client\n`);
 host=spawn(process.execPath,[join(modules,'@deepseek-ai/dsh/lib/bin.js'),'--profile','web','--port','0','--no-open'],{cwd:root,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home,DSH_TELEMETRY_DISABLED:'1',NODE_PATH:modules,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
 const collect=chunk=>{log=(log+chunk).slice(-45000)};host.stdout.on('data',collect);host.stderr.on('data',collect);
 const url=await until(()=>log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0],'Host URL');
 const main=join(root,'main.cjs');writeFileSync(main,`const{app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('lang','zh-CN');app.whenReady().then(()=>new BrowserWindow({width:1280,height:900,show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}}).loadURL(${JSON.stringify(url)}));`);
 electron=await _electron.launch({executablePath:req('electron'),args:[main,'--user-data-dir='+join(root,'electron')]});
 const page=await electron.firstWindow(),errors=[];await page.evaluate(()=>{window.guideClicks=[];document.addEventListener('click',event=>window.guideClicks.push({text:event.target.closest('button')?.textContent,at:Date.now()}),true)});page.on('pageerror',error=>errors.push(error.message));await page.waitForLoadState();
 for(const label of ['继续','稍后配置']){const button=page.getByRole('button',{name:label,exact:true});await button.waitFor({timeout:2000}).catch(()=>{});if(await button.isVisible().catch(()=>false))await button.click()}
 const lan=page.getByRole('dialog',{name:'设备与连接',exact:true}),guide=page.locator('aside.mochi-guide[role=region]');
 await lan.waitFor();assert.equal(await guide.count(),0,'nickname has priority over guide');
 await page.locator('[data-mochi-user-address=true]').fill(address);await page.getByRole('button',{name:'保存称呼',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.mochiUserProfileReady==='true');assert.equal(await guide.count(),0,'guide stays out of actual modal');
 await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();
 // No model credential is required for inspecting the interface.
 const later=page.getByRole('button',{name:'稍后配置',exact:true});if(await later.isVisible().catch(()=>false))await later.click();
 await guide.waitFor();assert.match(await guide.innerText(),/称呼已保存.*校园认证/);
 await page.screenshot({path:join(evidence,'guide-first.png')});
 await guide.getByRole('button',{name:'设置称呼与身份',exact:true}).click();await lan.waitFor();assert.equal(await guide.count(),0);
 await page.getByRole('button',{name:'关闭小信箱',exact:true}).click();await page.screenshot({path:join(evidence,'guide-returned.png')});await guide.waitFor({timeout:15000});await guide.locator('button').filter({hasText:/^展开这一步$/}).click();
 await guide.getByRole('button',{name:'我了解了，下一步',exact:true}).click();await guide.getByRole('heading',{name:'登录真正的校园账号'}).waitFor();
 assert.match(await guide.innerText(),/状态尚未确认/);
 // This fixture omits the campus package: it must report an unavailable real entry.
 await guide.getByRole('button',{name:'找到校园账号入口',exact:true}).click();await page.keyboard.press('Escape');
 await guide.waitFor();await guide.getByText(/没有找到校园账号入口/).waitFor();
 if(await guide.getByRole('button',{name:'展开这一步',exact:true}).count())await guide.locator('button').filter({hasText:/^展开这一步$/}).click();
 await guide.getByRole('button',{name:'我了解了，下一步',exact:true}).click();await guide.getByRole('button',{name:'我了解了，下一步',exact:true}).click();
 await guide.getByRole('heading',{name:'选一种合适的输入方式'}).waitFor();
 await guide.getByRole('button',{name:'找到拍题按钮',exact:true}).click();assert.match(await guide.innerText(),/当前没有拍题入口|已标出真实入口/);
 const geometry=await page.evaluate(()=>{const card=document.querySelector('.mochi-guide').getBoundingClientRect(),composer=[...document.querySelectorAll('[data-composer-card]')].find(n=>n.getClientRects().length)?.getBoundingClientRect();return{card:{top:card.top,bottom:card.bottom,right:card.right},composer:composer?{top:composer.top,bottom:composer.bottom}:null,width:innerWidth,height:innerHeight}});
 if(geometry.composer)assert.ok(geometry.card.bottom<=geometry.composer.top-10,'card leaves actual input unobstructed');
 await page.keyboard.press('Escape');await guide.waitFor();assert.match(await guide.innerText(),/首次指引会保留/);
 await page.reload();await guide.waitFor();assert.match(await guide.innerText(),/4 \/ 7/,'mandatory guide resumes saved step');
 await page.screenshot({path:join(evidence,'guide-reopened.png')});
 for(let index=0;index<3;index++){await guide.getByRole('button',{name:'我了解了，下一步',exact:true}).click();if(index===1&&role==='classroom'){await guide.getByRole('heading',{name:'准备好一节课的陪伴',exact:true}).waitFor();assert.match(await guide.innerText(),/课堂助手.*这节课结束.*课堂管家/);await guide.getByRole('button',{name:'打开课堂助手',exact:true}).click();await guide.getByText(/当前没有课堂助手入口/).waitFor();}}
 await guide.getByRole('heading',{name:'把 Mochi 调成喜欢的样子'}).waitFor();
 await guide.getByRole('button',{name:'打开记忆回看',exact:true}).click();assert.match(await guide.innerText(),/记忆回看入口还不可用/);
 // A cancelable received event is the public bridge contract used by the actual memory UI.
 await page.evaluate(()=>window.addEventListener('mochi-open-memory',event=>{event.preventDefault();window.guideMemoryReceived=true},{once:true}));
 await guide.getByRole('button',{name:'打开记忆回看',exact:true}).click();assert.equal(await page.evaluate(()=>window.guideMemoryReceived),true);
 await guide.getByRole('button',{name:'完成指引',exact:true}).click();await guide.waitFor({state:'hidden'});await page.reload();
 await page.getByRole('button',{name:'新手指引',exact:true}).first().waitFor();await sleep(300);assert.equal(await guide.count(),0,'completion survives reload');await page.getByRole('button',{name:'新手指引',exact:true}).first().click();await guide.waitFor();assert.match(await guide.innerText(),/1 \/ 7/,'replay starts from first step');await page.keyboard.press('Escape');await guide.waitFor({state:'hidden'});
 const stored=readFileSync(join(profile,'cordis.patch.yml'),'utf8');assert.match(stored,/status: complete/);assert.match(stored,/step: settings/);assert.match(stored,/version: 2/);
 const savedProfile=JSON.parse(readFileSync(join(home,'profile.json'),'utf8'));assert.equal(savedProfile[role==='teacher'?'preferredAddress':'classroomAddress'],address);
 assert.deepEqual(errors,[]);
 const result={role,harness:'0.2.0-rc.2',nicknameFirst:true,nicknamePersists:true,noModalOverlap:true,guideUsesOfficialPersistence:true,escapeCannotSkip:true,resumeSavedStep:true,replayCanExit:true,mandatoryVersion:2,completionReload:true,campusMissingExplicit:true,memoryCancelableContract:true,geometry,errors};writeFileSync(join(evidence,'guide-runtime.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){if(electron){const page=await electron.firstWindow();await page.screenshot({path:join(evidence,'guide-failure.png')}).catch(()=>{});console.error(await page.locator('.mochi-guide').ariaSnapshot().catch(()=>''));console.error(JSON.stringify(await page.evaluate(()=>({debug:window.guideDebug?.(),clicks:window.guideClicks,card:document.querySelector('.mochi-guide')?.outerHTML,ancestors:(()=>{let n=document.querySelector('.mochi-guide');const out=[];while(n){out.push({tag:n.tagName,attrs:[...n.attributes].map(a=>[a.name,a.value])});n=n.parentElement}return out})(),composer:[...document.querySelectorAll('[data-composer-card]')].map(n=>({html:n.outerHTML.slice(0,200),rect:n.getBoundingClientRect().toJSON()}))})))) ;console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-5000))}console.error(log.replace(/token=\S+/g,'token=[redacted]').slice(-3000));throw error}
finally{await electron?.close();if(host&&host.exitCode===null){host.kill('SIGTERM');await Promise.race([new Promise(done=>host.once('exit',done)),sleep(5000)])}rmSync(root,{recursive:true,force:true})}
