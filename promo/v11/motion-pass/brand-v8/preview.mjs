import puppeteer from 'puppeteer-core';
import {resolve,dirname} from 'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
import{writeFileSync,mkdirSync}from'node:fs';
const dir=dirname(fileURLToPath(import.meta.url)),out=resolve(dir,'evidence');mkdirSync(out,{recursive:true});
const samples={greeting:[1.9,3.8,5.2,6.5,7.8],opening:[5.8,13],team:[2,8,20.4],teaching:[2,8,15],delivery:[4,12],model:[6,14],mailbox:[7,11],students:[3,18,29.8,30.7,32],query:[14,24],collaboration:[5,17],daily:[3,11,17,25,31,39,45],ending:[2,4.5,6.5]};
const selected=process.argv.slice(2);if(selected[0]==='bridges'){for(const key of Object.keys(samples))delete samples[key];for(let i=0;i<7;i++)if(selected.length===1||selected.slice(1).includes(String(i)))samples['bridges/'+i]=[.05,.9,1.5,2.3]}
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});const report=[];
try{const page=await browser.newPage();await page.setViewport({width:2560,height:1440});let errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [id,times]of Object.entries(samples)){
  if(selected.length&&selected[0]!=='bridges'&&!selected.includes(id))continue;errors=[];
  await page.goto(pathToFileURL(resolve(dir,id,'index.html')).href,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
  for(const [i,time]of times.entries()){
   const state=await page.evaluate(async t=>{Object.values(window.__timelines)[0].seek(t);
    await Promise.all([...document.querySelectorAll('video')].map(v=>new Promise(r=>{const local=t-Number(v.dataset.start||0);if(local<0||local>Number(v.dataset.duration||100)||!Number.isFinite(v.duration))return r();v.onseeked=r;v.currentTime=Math.max(0,Math.min(local,v.duration-.01));setTimeout(r,1000)})));
    return {time:t,background:getComputedStyle(document.querySelector('#film')).backgroundColor,missingVideo:[...document.querySelectorAll('video')].filter(v=>v.error).map(v=>v.src),missingImages:[...document.images].filter(v=>!v.complete||!v.naturalWidth).map(v=>v.src),fonts:document.fonts.status,brand:window.brandEvidence||null,actor:window.actorEvidence||null,badText:document.body.textContent.includes('\uFFFD')};},time);
   await page.screenshot({path:resolve(out,`${id.replace('/','-')}-${i}.jpg`),type:'jpeg',quality:87});report.push({id,...state,errors:[...errors]});
  }
 }
}finally{await browser.close()}
const bad=report.filter(r=>r.errors.length||r.missingVideo.length||r.missingImages.length||r.badText);
writeFileSync(resolve(dir,selected[0]==='bridges'?'bridge-preview.json':'preview-validation.json'),JSON.stringify(report,null,2)+'\n');console.log('Previewed',report.length,'issues',bad);if(bad.length)process.exit(1);
