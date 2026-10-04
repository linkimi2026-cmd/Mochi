// Headless CSS geometry fixture: upstream rc.2 header CSS plus the plugin's local rules.
// Not a substitute for the packaged Host/React entry smoke.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const repo=resolve(import.meta.dirname,'../../..'),require=createRequire(join(repo,'apps/desktop/package.json'));
const {chromium}=require('playwright');
const upstream=readFileSync(join(repo,'apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'),'utf8');
const original=JSON.parse(upstream.match(/const css\$4 = ("(?:[^"\\]|\\.)*");/u)[1]);
const source=readFileSync(new URL('../client-entry.mjs',import.meta.url),'utf8');
const local=source.match(/style.textContent='([^']+)';/u)[1];
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const results=[];
try {
 const page=await browser.newPage();
 for(const viewport of [880,360])for(const sidebar of [0,56,256])for(const state of ['sessionless','blank','active','expanded']) {
  if(viewport-sidebar<300)continue;
  await page.setViewportSize({width:viewport,height:500});
  const session=state!=='sessionless',active=['active','expanded'].includes(state),expanded=state==='expanded';
  await page.setContent(`<html data-platform="darwin"><style>${original}${local}body{margin:0}main{margin-left:${sidebar}px;width:${viewport-sidebar}px}button{box-sizing:border-box;width:36px;height:36px;padding:0;flex-shrink:0}</style><main><header class="wSkVaW_header ${active?'':'wSkVaW_headerBlank'}"><div class="wSkVaW_headerLeading" data-conversation-header-leading><div data-slot="conversation.header.leading" style="display:contents"><button class="mochi-reply-audio" data-mochi-reply-toggle="root">S</button></div></div>${session?'<div data-slot="conversation.session.header" style="display:contents">':''}<div class="wSkVaW_titleRow">${active?'<div class="wSkVaW_titleCluster"><nav class="wSkVaW_crumbs"><span class="wSkVaW_crumb">很长的课堂讨论标题用于验证窄窗口不会把原生入口挤出或盖住</span></nav></div><div class="wSkVaW_headerUtilities"><button>U</button></div>':''}${session?`<div class="wSkVaW_headerCorner" data-conversation-header-corner>${expanded?'':'<button data-sidebar-right-expand>R</button>'}</div>`:''}</div>${session?'</div>':''}</header></main></html>`);
  const data=await page.evaluate(()=>{
   const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};};
   return {header:rect(document.querySelector('header')),speaker:rect(document.querySelector('[data-mochi-reply-toggle]')),opener:document.querySelector('[data-sidebar-right-expand]')?rect(document.querySelector('[data-sidebar-right-expand]')):null,title:document.querySelector('nav')?rect(document.querySelector('nav')):null,pageOverflow:document.documentElement.scrollWidth>innerWidth};
  });
  for(const rect of [data.speaker,data.opener,data.title].filter(Boolean))assert.ok(rect.left>=data.header.left&&rect.right<=data.header.right+0.1,JSON.stringify({viewport,sidebar,state,data}));
  if(data.opener){assert.ok(data.opener.right<=data.speaker.left,JSON.stringify(data));assert.ok(Math.abs((data.opener.top+data.opener.bottom)-(data.speaker.top+data.speaker.bottom))<1,JSON.stringify({state,data}));}
  if(data.title)assert.ok(data.title.right<=Math.min(data.opener?.left??Infinity,data.speaker.left),JSON.stringify(data));
  assert.equal(data.pageOverflow,false);results.push({viewport,sidebar,state,...data});
 }
 const path=join(repo,'docs/evidence/harness-upgrade-2026-09-30/voice-header-layout.json');writeFileSync(path,JSON.stringify({passed:true,fixture:'actual rc.2 CSS and SlotOutlet display:contents anchors / representative contents, headless Chrome; not App',results},null,2)+'\n');console.log(path+' '+results.length+' cases');
}finally{await browser.close();}
