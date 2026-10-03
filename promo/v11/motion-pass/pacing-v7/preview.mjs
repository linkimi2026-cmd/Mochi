import puppeteer from 'puppeteer-core';import{resolve,dirname}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
const dir=dirname(fileURLToPath(import.meta.url)),evidence=resolve(dir,'../evidence/pacing-v7');mkdirSync(evidence,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});
const selected=process.argv.slice(2),chapters=JSON.parse(readFileSync(resolve(dir,'chapters.json'))),report=[];
try{const page=await browser.newPage();await page.setViewport({width:2560,height:1440});let errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const id of selected.length?selected:[...chapters.map(c=>c.id),'daily','ending']){
  errors=[];await page.goto(pathToFileURL(resolve(dir,id,'index.html')).href,{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
  const c=chapters.find(c=>c.id===id),times=c?c.windows.map(w=>w[0]+(w[1]-w[0])*.5):id==='daily'?[3,10.5,17,25,31,39,45]:[1.7,3.5,5.5,7.7];
  if(id==='model')times.push(12.1,15.7,18.9,21.7);
  for(const [i,t]of times.entries()){
   const state=await page.evaluate(async t=>{
    Object.values(window.__timelines)[0].seek(t);
    await Promise.all([...document.querySelectorAll('video')].map(v=>new Promise(r=>{const local=t-Number(v.dataset.start||0);if(local<0||local>Number(v.dataset.duration||100)||!Number.isFinite(v.duration))return r();v.onseeked=r;v.currentTime=Math.min(local,v.duration-.01);setTimeout(r,800)})));
    return {time:t,missingVideo:[...document.querySelectorAll('video')].filter(v=>v.error).map(v=>v.src),fonts:document.fonts.status,evidence:window.pacingEvidence||null};
   },t);
   await page.screenshot({path:resolve(evidence,`${id}-${i}.jpg`),type:'jpeg',quality:85});report.push({id,...state,errors:[...errors]});
  }
 }
}finally{await browser.close()}
writeFileSync(resolve(dir,'preview-validation.json'),JSON.stringify(report,null,2));console.log('Previewed',report.length,'frames; errors',report.filter(r=>r.errors.length||r.missingVideo.length).length);
