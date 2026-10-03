import puppeteer from 'puppeteer-core';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
const dir=dirname(fileURLToPath(import.meta.url));
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});
const result=[];
try {
 const page=await browser.newPage();
 for(const id of ['greeting','mailbox','collaboration','ending',...Array.from({length:7},(_,i)=>`bridges/${i}`)]) {
  await page.goto(pathToFileURL(resolve(dir,id,'index.html')).href,{waitUntil:'load'});
  const row=await page.evaluate(()=>{
   const timeline=Object.values(window.__timelines)[0],duration=Number(document.querySelector('#film').dataset.duration),states=new Set(),samples=[];
   const seek=t=>{timeline.seek(t);const clone=document.querySelector('#mo-actor svg').cloneNode(true);clone.querySelectorAll('[display=none],circle[r="0"]').forEach(n=>n.remove());return {evidence:{...window.actorEvidence},svg:clone.innerHTML}};
   for(let t=.05;t<duration;t+=.1){const s=seek(t);states.add(s.evidence.state);if(!s.evidence.finite)throw Error('Invalid geometry at '+t);samples.push(s.evidence)}
   const at=Math.min(1.1,duration/2),first=seek(at);seek(duration-.01);seek(.02);const repeat=seek(at);
   if(first.svg!==repeat.svg)throw Error('Visible geometry differs after random seek');
   return {palette:first.evidence.palette,states:[...states],samples:samples.length,geometryFinite:true,randomSeekIdentical:true,thinkingHasTwoSideDots:samples.filter(s=>s.state==='thinking'&&s.dots===2).length};
  });
  result.push({id,...row});
 }
} finally {await browser.close()}
writeFileSync(resolve(dir,'actor-validation.json'),JSON.stringify({note:'Thinking has two side dots plus the body as the center dot. Media validation is separate.',results:result},null,2)+'\n');
console.log(JSON.stringify(result,null,2));
