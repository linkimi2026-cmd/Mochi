import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {createMechanicalAudio} from '../../../client-plugins/jxl-theme/scripts/mechanical-audio.mjs';
import {tracks} from './score-tracks.mjs';
const root=dirname(fileURLToPath(import.meta.url)),timeline=JSON.parse(readFileSync(resolve(root,'timeline.json'))),chapters=[...timeline.chapters.filter(c=>c.type==='chapter'),...timeline.chapters.filter(c=>c.type==='mo-handoff').map(c=>({...c,sourceStart:0}))];
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--allow-file-access-from-files']});
const cues=[];
try{
 const page=await browser.newPage();await page.setViewport({width:2560,height:1440});
 // Source offsets follow the actual compound clip edits, not approximate chapter durations.
 const sourceChapters=timeline.edition===8?
 [['brand-v8/greeting',0,0,8],['brand-v8/opening',0,4,18,4],['brand-v8/team',1,0,23.35],['brand-v8/teaching',2,0,25],['brand-v8/delivery',2,22,16],['brand-v8/model',3,0,26.8],['brand-v8/mailbox',4,0,18],['brand-v8/students',5,0,50],['brand-v8/query',6,0,30],['brand-v8/collaboration',6,30,30],['brand-v8/daily',7,0,48],['brand-v8/ending',7,47.4,8]]:
 timeline.edition===7?
 [['../greeting-chapter',0,0,4],['pacing-v7/opening',0,4,18],['pacing-v7/team',1,0,23.35],['pacing-v7/teaching',2,0,25],['pacing-v7/delivery',2,22,16],['pacing-v7/model',3,0,26.8],['pacing-v7/mailbox',4,0,18],['pacing-v7/students',5,0,50],['pacing-v7/query',6,0,30],['pacing-v7/collaboration',6,30,30],['pacing-v7/daily',7,0,48],['pacing-v7/ending',7,47.4,8]]:
 [['../greeting-chapter',0,0,4],['../opening-chapter',0,4,18],['../team-dialogue',1,0,23.35],['../teaching-chapter',2,0,22],['../delivery-chapter',2,22,16],['../model-chapter',3,0,26.8],['../mailbox-chapter',4,0,18],['../student-chapter',5,0,50],['native-query',6,0,30],['../collaboration-chapter',6,30,30],['../master-preview/supplement',7,-36,92]];
 const sources=[...sourceChapters,...[0,1,2,4,5,6].map(i=>[(timeline.edition===8?'brand-v8/':'')+'bridges/'+i,8+i,0,chapters[8+i].duration])];
 for(const [folder,index,offset,length,sourceFrom=0] of sources){
  const file=resolve(root,folder,'index.html');
  await page.goto(pathToFileURL(file).href,{waitUntil:'load',timeout:30000});
  const events=await page.evaluate(()=>Object.values(window.__timelines||{}).flatMap(tl=>tl.getChildren(true,true,false).flatMap(t=>{
   if(t.vars.opacity!==1||!t.vars.stagger||!t.duration())return [];
   return t.targets().flatMap((el,i)=>el?.matches?.('.glyph,.char,.copy-word')?[{at:t.globalTime(0)+i*Number(t.vars.stagger),text:el.textContent}]:[]);
  })));
  if(!events.length)console.log('No staggered typing in',folder);
  const chapter=chapters[index];
  for(const event of events){const sourceTime=offset+event.at,time=chapter.start+sourceTime-chapter.sourceStart;
   if(event.at>=sourceFrom&&event.at<length&&time>=chapter.start&&time<chapter.start+chapter.duration&&event.text.trim())cues.push({time,sourceTime,source:file,text:event.text,kind:'animated-letter'});
  }
 }
 // Cover uses the exact existing vector mark. No regeneration or redrawing.
 const brand=resolve(root,'../../../apps/desktop/build/icon-source.svg');
 const svg=readFileSync(brand,'utf8');
 await page.setContent(`<html><body style="margin:0;width:2560px;height:1440px;background:#f7f5ee;display:grid;place-items:center"><div style="width:650px;height:650px">${svg}</div></body></html>`);
 await page.screenshot({path:resolve(root,'output/Mochi_品牌封面_2K.png')});
 writeFileSync(resolve(root,'cover-source.json'),JSON.stringify({source:brand,width:2560,height:1440,unmodifiedVector:true},null,2)+'\n');
}finally{await browser.close()}
// The same product sound generator supplies a short, quieter key press/release pair.
let context;const voices=[];
class AudioContext{
 constructor(){context=this;this.sampleRate=48000;this.currentTime=0;this.state='running';this.destination={}}
 createBuffer(_,n){const data=new Float32Array(n);return{data,getChannelData:()=>data}}
 createGain(){return{gain:{value:0},connect(){},disconnect(){}}}
 createBufferSource(){return{buffer:null,gain:null,connect(g){this.gain=g},disconnect(){},stop(){},start(t){voices.push({time:t,data:this.buffer.data,gain:this.gain.gain.value})}}}
}
const ui=createMechanicalAudio({AudioContext});ui.arm();ui.play('press');context.currentTime=.038;ui.play('release');
const samples=new Float32Array(Math.ceil(timeline.duration*48000));
cues.sort((a,b)=>a.time-b.time);
// Dense letter entrances are grouped to avoid an abrasive machine-gun sound.
const played=cues.filter((cue,i)=>!i||cue.time-cues[i-1].time>=.045||i%3===0);
for(const [i,cue] of played.entries())for(const voice of voices){const start=Math.round((cue.time+voice.time)*48000),gain=.65+(i%5)*.045;for(let j=0;j<voice.data.length&&j+start<samples.length;j++)samples[start+j]+=voice.data[j]*voice.gain*gain}
writeFileSync(resolve(root,'assets/typing.f32'),Buffer.from(samples.buffer));
const ff=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'});
ff(['-f','f32le','-ar','48000','-ac','1','-i',resolve(root,'assets/typing.f32'),'-ac','2','-y',resolve(root,'assets/typing.wav')]);
const sync=JSON.parse(readFileSync(resolve(root,'score-sync.json')));
for(const track of tracks){
 const stem=samples.slice(),accents=sync.reports.find(r=>r.label===track.id).mapping.filter(c=>c.addedAccent);
 for(const cue of accents){const start=Math.round(cue.target*48000);for(let i=0;i<.18*48000&&start+i<stem.length;i++){const t=i/48000;stem[start+i]+=.18*Math.sin(2*Math.PI*(90*t+3*(1-Math.exp(-t*35))))*Math.min(1,t/.003)*Math.exp(-t*30)}}
 const folder=resolve(root,`assets/scores/${track.id}`);writeFileSync(resolve(folder,'typing-accent.f32'),Buffer.from(stem.buffer));
 ff(['-i',resolve(folder,'delivery-final.wav'),'-f','f32le','-ar','48000','-ac','1','-i',resolve(folder,'typing-accent.f32'),'-filter_complex',`[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.9:level=false:latency=true,atrim=duration=${timeline.duration}[a]`,'-map','[a]','-ar','48000','-ac','2','-y',resolve(folder,'typed-final.wav')]);
}

writeFileSync(resolve(root,'typing-cues.json'),JSON.stringify({method:'Actual GSAP letter entrance times, mapped through compound clip offsets and chapter trims. Dense glyphs grouped. Does not infer keystrokes inside recorded video.',generator:'client-plugins/jxl-theme/scripts/mechanical-audio.mjs',cues,played,peak:samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0)},null,2)+'\n');
console.log('Typing cues',cues.length,'played',played.length);
