import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMechanicalAudio} from '../../../client-plugins/jxl-theme/scripts/mechanical-audio.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),plan=JSON.parse(readFileSync(resolve(dir,'plan.json'))),h=plan.handleSeconds;
const choreography=[
 {clicks:[8.75,14.42,20.65],accents:[1.15,4.05,8.75,14.42,20.65]},
 {clicks:[6.4,14.7],accents:[6.4,12.85,19.9]},
 {clicks:[],accents:[1.8,7.2,12.6,21,23.5,28.8,31.9]},
 {clicks:[3.2,15.3,17.5,20.3],accents:[3.2,10.45,15.3,20.3]},
 {clicks:[5.15],accents:[1.5,3.3,5.15,7.45,15.35]},
 {clicks:[29.1,31.2],accents:[1.4,7.67,15.5,20.6,25.3,32.65,37.55,44.4]},
 {clicks:[2.7],accents:[2.7,7.8,13.95,21.05,30.8,33.5,39.8,44.2,46.2,50,52,54.8,56.8]},
 {clicks:[],accents:[3,15,27,39,51]},
];
let time=0;const clicks=[],candidates=[];
for(const [i,ch]of plan.chapters.entries()){
 const skip=i?h:0,length=ch.duration-skip-(i<plan.chapters.length-1?h:0);
 for(const kind of ['clicks','accents'])for(const t of choreography[i][kind])if(t>=skip&&t<skip+length)(kind==='clicks'?clicks:candidates).push({time:time+t-skip,chapter:ch.name,sourceTime:t});
 time+=length;
 if(i<plan.chapters.length-1){const duration=plan.bridgeDurations?.[i]??plan.bridgeSeconds;candidates.push({time:time+1.9*duration/6,chapter:'Mo 场景接力',sourceTime:1.9});time+=duration}
}
// Closely spaced clicks keep their SFX; music anchors leave enough phrase to stretch naturally.
const accents=[];for(const x of candidates.sort((a,b)=>a.time-b.time))if(!accents.length||x.time-accents.at(-1).time>=2.7)accents.push(x);
if(Math.abs(time-plan.duration)>.001)throw Error('Choreography duration mismatch');
writeFileSync(resolve(dir,'choreography-cues.json'),JSON.stringify({duration:time,accents,clicks,clickSource:'client-plugins/jxl-theme/scripts/mechanical-audio.mjs'},null,2)+'\n');
const ff=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'});
const previous=process.argv.includes('--refine')?JSON.parse(readFileSync(resolve(dir,'score-sync.json'))):null;
const reports=[];
for(const label of ['own','k3']){
 const part=resolve(dir,'assets/scores',label),beats=JSON.parse(readFileSync(resolve(part,'beats/music.wav.json'))).beats;
 const firstTarget=accents[0]?.time??0;
 const hasOpeningBeat=beats.some(b=>b.time>=firstTarget*.88&&b.time<=firstTarget*1.12);
 const openingBeat=hasOpeningBeat?null:beats.filter(b=>b.time>=firstTarget&&b.time<=firstTarget+2).sort((a,b)=>b.strength-a.strength)[0];
 if(!hasOpeningBeat&&!openingBeat)throw Error('No usable opening beat for '+label);
 const openingTrim=openingBeat?openingBeat.time-firstTarget:0;
 const mapping=[{target:0,source:openingTrim,strength:0}];
 for(const cue of accents){
  const last=mapping.at(-1),dt=cue.time-last.target,predicted=last.source+dt;
  const options=beats.filter(b=>b.time>last.source&&b.time-last.source>=dt*.88&&b.time-last.source<=dt*1.12);
  if(!options.length)throw Error(`No bounded beat for ${label} at ${cue.time}`);
  options.sort((a,b)=>(Math.abs(a.time-predicted)/dt-.055*a.strength)-(Math.abs(b.time-predicted)/dt-.055*b.strength));
  mapping.push({target:cue.time,source:options[0].time,strength:options[0].strength,chapter:cue.chapter});
 }
 if(previous){const prior=previous.reports.find(r=>r.label===label);for(let i=1;i<mapping.length;i++){const old=prior.mapping[i],check=prior.renderedAttackChecks.find(c=>Math.abs(c.cueSeconds-old.target)<.001),tempo=(old.source-prior.mapping[i-1].source)/(old.target-prior.mapping[i-1].target);mapping[i].source=old.source+(check?.offsetMs||0)/1000*tempo;}}
 const last=mapping.at(-1);mapping.push({target:time,source:last.source+time-last.target,strength:0});
 const available=Number(JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',resolve(part,'music.wav')],{encoding:'utf8'})).format.duration);
 if(mapping.at(-1).source>available)throw Error('Music source too short for '+label);
 const segments=[];
 for(let i=1;i<mapping.length;i++){
  const a=mapping[i-1],b=mapping[i],length=b.target-a.target,tempo=(b.source-a.source)/length,path=resolve(part,`slice-${i}.wav`);
  ff(['-ss',String(a.source),'-i',resolve(part,'music.wav'),'-t',String(b.source-a.source),'-af',`atempo=${tempo},apad,atrim=duration=${length},afade=t=in:d=0.004,afade=t=out:st=${Math.max(0,length-.004)}:d=0.004`,'-ar','48000','-ac','2','-y',path]);
  segments.push(path);
 }
 writeFileSync(resolve(part,'concat.txt'),segments.map(p=>`file '${p}'`).join('\n'));
 ff(['-f','concat','-safe','0','-i',resolve(part,'concat.txt'),'-af',`loudnorm=I=-18:TP=-2:LRA=8,afade=t=in:d=0.5,afade=t=out:st=${time-3}:d=3`,'-ar','48000','-ac','2','-y',resolve(part,'aligned.wav')]);
 reports.push({label,openingTrim,mapping,maxTempoChange:Math.max(...mapping.slice(1).map((b,i)=>Math.abs((b.source-mapping[i].source)/(b.target-mapping[i].target)-1))),method:'Original beat landmarks, optional opening trim, bounded pitch-preserving atempo, four-ms edge fades; listening review still required.'});
}
// Ask the product's own sound generator for its samples, rather than copying its synthesis code.
let context;const voices=[];
class AudioContext{
 constructor(){context=this;this.sampleRate=48000;this.currentTime=0;this.state='running';this.destination={}}
 createBuffer(_,n){const data=new Float32Array(n);return{data,getChannelData:()=>data}}
 createGain(){return{gain:{value:0},connect(){},disconnect(){}}}
 createBufferSource(){return{buffer:null,gain:null,connect(g){this.gain=g},disconnect(){},stop(){},start(t){voices.push({time:t,data:this.buffer.data,gain:this.gain.gain.value})}}}
}
const ui=createMechanicalAudio({AudioContext});ui.arm();ui.play('press');context.currentTime=.08;ui.play('release');
const samples=new Float32Array(Math.ceil(time*48000));
for(const cue of clicks)for(const v of voices){const start=Math.round((cue.time+v.time)*48000);for(let i=0;i<v.data.length&&i+start<samples.length;i++)samples[i+start]+=v.data[i]*v.gain*2.2}
writeFileSync(resolve(dir,'assets/clicks.f32'),Buffer.from(samples.buffer));
ff(['-f','f32le','-ar','48000','-ac','1','-i',resolve(dir,'assets/clicks.f32'),'-ac','2','-y',resolve(dir,'assets/clicks.wav')]);
for(const label of ['own','k3']){
 const part=resolve(dir,'assets/scores',label);
 ff(['-i',resolve(part,'aligned.wav'),'-i',resolve(dir,'assets/clicks.wav'),'-filter_complex','[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.9:level=false:latency=true[a]','-map','[a]','-ar','48000','-ac','2','-y',resolve(part,'final.wav')]);
}
writeFileSync(resolve(dir,'score-sync.json'),JSON.stringify({duration:time,accentCount:accents.length,clickCount:clicks.length,reports,listenVerified:false,refinedFromRenderedAttacks:!!previous},null,2)+'\n');
