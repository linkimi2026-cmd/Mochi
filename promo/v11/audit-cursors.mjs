import puppeteer from 'puppeteer-core';
import {writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const chapters=['opening-chapter','team-dialogue','teaching-chapter','model-chapter','mailbox-chapter','student-chapter','motion-pass/native-query','master-preview/supplement'];
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files','--autoplay-policy=no-user-gesture-required']});
const reports=[];
try{for(const chapter of chapters){
 const page=await browser.newPage();await page.setViewport({width:2560,height:1440});await page.goto(pathToFileURL(resolve(root,chapter,'index.html')).href,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
 const report=await page.evaluate(()=>{
  const tl=Object.values(window.__timelines||{})[0];if(!tl)return{error:'No timeline'};
  const nodes=[...document.querySelectorAll('.film-pointer')];let visibleSamples=0;const failures=[],clickOffsets=[];
  for(let i=0;i<=Math.ceil(tl.duration()*120);i++){
   const t=Math.min(tl.duration(),i/120);tl.seek(t,true);
   for(const n of nodes){const s=getComputedStyle(n);if(Number(s.opacity)<.05)continue;visibleSamples++;const r=n.getBoundingClientRect();const ring=document.querySelector('.film-pointer-ring');if(ring&&Number(getComputedStyle(ring).opacity)>.75){const q=ring.getBoundingClientRect();const delta=Math.hypot(q.x+q.width/2-r.x-4.5,q.y+q.height/2-r.y-3);if(delta>6)clickOffsets.push({t,delta});}const m=new DOMMatrix(s.transform);const sx=Math.hypot(m.a,m.b),sy=Math.hypot(m.c,m.d);
    if(Math.abs(r.width-48)>.05||Math.abs(r.height-60)>.05||Math.abs(sx-1)>.001||Math.abs(sy-1)>.001)failures.push({t,width:r.width,height:r.height,sx,sy});
   }
  }
  return{duration:tl.duration(),cursorCount:nodes.length,visibleSamples,failures:failures.slice(0,20),failureCount:failures.length,clickOffsets:clickOffsets.slice(0,20),clickOffsetCount:clickOffsets.length};
 });reports.push({chapter,...report});await page.close();
}}finally{await browser.close()}
writeFileSync(resolve(root,'cursor-audit.json'),JSON.stringify({scope:'Synthetic overlay pointers only; embedded recording cursors require visual inspection.',fps:120,reports},null,2)+'\n');
console.log(JSON.stringify(reports));if(reports.some(r=>r.error||r.failureCount||r.clickOffsetCount))process.exitCode=1;
