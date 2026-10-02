import puppeteer from 'puppeteer-core';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
const root=resolve('promo/v11/motion-pass'),plan=JSON.parse(readFileSync(root+'/plan.json'));
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});const report=[];
try{const p=await b.newPage();await p.setViewport({width:2560,height:1440});p.on('pageerror',e=>report.push({error:e.message}));
for(const i of (process.argv.length>2?process.argv.slice(2).map(Number):[0,1,2,4,5,6])){await p.goto(pathToFileURL(root+`/bridges/${i}/index.html`).href,{waitUntil:'load'});await p.evaluate(()=>document.fonts.ready);for(const [n,f]of [.25,.5,.92].entries()){const t=plan.bridgeDurations[i]*f;await p.evaluate(async({i,t})=>{window.__timelines['mochi-bridge-'+i].seek(t);await Promise.all([...document.querySelectorAll('video')].map(v=>new Promise(r=>{v.onseeked=r;v.currentTime=t;setTimeout(r,1500)})));},{i,t});await p.screenshot({path:root+`/evidence/reference-study/mo-${i}-${n}.png`});report.push({i,time:t,text:await p.$eval('#words',e=>e.textContent)})}}
}finally{await b.close()}
writeFileSync(root+'/transition-preview.json',JSON.stringify(report,null,2)+'\n');console.log(report);
