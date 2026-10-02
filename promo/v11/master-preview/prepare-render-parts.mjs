import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),source=readFileSync(resolve(dir,'supplement/index.html'),'utf8'),shots=JSON.parse(readFileSync(resolve(dir,'supplement/shots.json'),'utf8'));
for(const [name,start,end] of [['campus',0,36],['daily',36,92]]){
 const part=resolve(dir,`assets/render-${name}`);mkdirSync(part,{recursive:true});if(!existsSync(resolve(part,'assets')))symlinkSync(resolve(dir,'supplement/assets'),resolve(part,'assets'));
 let html=source;const chosen=shots.filter(s=>s.start>=start&&s.start<end).map(s=>({...s,start:s.start-start}));
 for(const s of shots){if(s.start<start||s.start>=end)html=html.replace(new RegExp(`<section id="scene-${s.id}"[\\s\\S]*?</section>`),'');else html=html.replace(`data-start="${s.start}" data-duration="${s.duration}"`,`data-start="${s.start-start}" data-duration="${s.duration}"`)}
 html=html.replace(/const shots=\[.*?\];/,`const shots=${JSON.stringify(chosen)};`);
 html=html.replaceAll('duration:92','duration:'+(end-start)).replaceAll('time:92','time:'+(end-start));
 if(name==='daily')for(const t of [84,84.6,85.5])html=html.replaceAll(`},${t})`,`},${t-start})`);
 else html=html.replace(/tl\.set\('#outro'[\s\S]*?let t=0;/,'let t=0;');
 writeFileSync(resolve(part,'index.html'),html);
}
