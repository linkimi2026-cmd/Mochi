import {mkdirSync,readFileSync,writeFileSync,copyFileSync,existsSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {petPaletteCss} from '../../../client-plugins/jxl-theme/scripts/pet-palettes.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../..'),shared=resolve(dir,'assets');
mkdirSync(shared,{recursive:true});
mkdirSync(resolve(dir,'ending'),{recursive:true});
if(!existsSync(resolve(dir,'ending/assets')))symlinkSync('../assets',resolve(dir,'ending/assets'));
for(const n of ['gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf'])copyFileSync(resolve(dir,'../../v10/assets',n),resolve(shared,n));
writeFileSync(resolve(shared,'palettes.css'),petPaletteCss);
execFileSync(resolve(root,'promo/node_modules/.bin/esbuild'),['promo/v11/motion-pass/native.tsx','--bundle','--format=iife','--outfile=promo/v11/motion-pass/assets/native.js','--alias:react=./apps/desktop/runtime-modern/node_modules/react','--jsx=automatic','--alias:react/jsx-runtime=./apps/desktop/runtime-modern/node_modules/react/jsx-runtime.js','--define:process.env.NODE_ENV="production"'],{cwd:root,stdio:'inherit'});
const chapters=[
 ['首页与需求','../opening-chapter/output/opening-presets.mp4',0,18],
 ['多Agent与内置配色','../team-dialogue/output/team-dialogue.mp4',0,23.35],
 ['真实课件与教学成果','../delivery-chapter/output/teaching-and-delivery.mp4',0,38],
 ['交互模型','../model-chapter/output/model-journey.mp4',0,26.8],
 ['叮咚与小信箱','../mailbox-chapter/output/mailbox-review.mp4',0,18],
 ['跨端消息与叫人','../student-chapter/output/student-chapter-paper-world.mp4',0,50],
 ['Mochi原生查人、流转与教师协作','../collaboration-chapter/output/query-movement-a2a.mp4',0,60],
 ['记忆、自动化与结尾','../master-preview/supplement/output/continuation.mp4',36,56],
].map(([name,path,start,duration])=>({name,source:resolve(dir,path),start,duration}));
const bridgeDurations=[2.8,3.2,3,4.4,3.4,2.6,3.2];
const directions=[
 {title:'一位伙伴。\n也可以是一支团队。',old:{x:-700,y:180,z:-640,rx:6,ry:16},next:{x:1050,y:180,z:-700,rx:-5,ry:-16},mo:{x:1080,y:790},tint:'#ede2cd',turn:22},
 {title:'把分工，\n变成看得见的成果。',old:{x:-900,y:450,z:-520,rx:12,ry:-12},next:{x:580,y:750,z:-800,rx:25,ry:10},mo:{x:1160,y:830},tint:'#e0e9d6',turn:-20},
 {title:'想法，\n还可以动起来。',old:{x:-580,y:580,z:-600,rx:-15,ry:14},next:{x:600,y:-460,z:-950,rx:18,ry:-16},mo:{x:1080,y:830},tint:'#dae9e1',turn:24},
 {title:'叮咚。\n有人在等你的回应。',old:{x:-1080,y:250,z:-660,rx:0,ry:22},next:{x:1080,y:240,z:-660,rx:0,ry:-22},mo:{x:1080,y:790},tint:'#e6e4d0',turn:28},
 {title:'一封信，\n连接两间教室。',old:{x:-1080,y:120,z:-660,rx:0,ry:22},next:{x:1080,y:120,z:-660,rx:0,ry:-22},mo:{x:1080,y:790},tint:'#e6e4d0',turn:28},
 {title:'同学在哪里？\n直接问 Mochi。',old:{x:-750,y:480,z:-580,rx:-12,ry:15},next:{x:840,y:320,z:-900,rx:-8,ry:-20},mo:{x:1080,y:780},tint:'#e6daca',turn:24},
 {title:'接住今天。\n也记得明天。',old:{x:-820,y:420,z:-650,rx:16,ry:15},next:{x:850,y:680,z:-800,rx:18,ry:-12},mo:{x:1080,y:810},tint:'#dde6d7',turn:20},
];
function ff(args){execFileSync('ffmpeg',['-v','error',...args],{stdio:'inherit'})}
for(let i=process.argv.includes('--media-only-last')?4:0;i<directions.length;i++){
 if(process.argv.some(a=>a.startsWith('--bridge='))&&i!==Number(process.argv.find(a=>a.startsWith('--bridge=')).split('=')[1]))continue;
 const seconds=bridgeDurations[i];
 const c=directions[i],part=resolve(dir,'bridges/'+i),assets=resolve(part,'assets');mkdirSync(assets,{recursive:true});
 const typography=[
  'left:160px;top:90px;width:2240px;text-align:center;font-size:106px',
  'left:1180px;top:165px;width:1220px;text-align:right;font-family:MoSerif;font-size:98px',
  'left:180px;top:100px;width:1100px;text-align:left;font-size:110px',
  'display:none',
  'left:180px;top:100px;width:2200px;text-align:center;font-family:MoSerif;font-size:86px',
  'left:170px;top:105px;width:1350px;font-size:104px',
  'left:1270px;top:165px;width:1110px;text-align:right;font-size:98px',
 ][i];
 const actorPositions=[{x:1060,y:880},{x:390,y:880},{x:1100,y:850},{x:1120,y:810},{x:1100,y:850},{x:1920,y:860},{x:390,y:800}];
 c.mo=actorPositions[i];
 if(i===5)c.title='同学在哪里？';

 for(const n of ['native.js','native.css','palettes.css','gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf']){const p=resolve(assets,n);if(!existsSync(p))symlinkSync(resolve(shared,n),p)}
 for(const [side,ch,at,pad]of[['out',chapters[i],chapters[i].start+chapters[i].duration-1.2,'stop'],['in',chapters[i+1],chapters[i+1].start,'stop']]){
  if(!existsSync(ch.source)){console.log('pending bridge media',i,side);continue}
  if(!process.argv.includes('--html-only')){
   ff(['-ss',String(at),'-i',ch.source,'-t','1.2','-an','-vf','fps=120,setsar=1','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','22000000','-y',resolve(assets,side+'-short.mp4')]);
   ff(['-i',resolve(assets,side+'-short.mp4'),'-vf',`tpad=${side==='in'?'start':pad}_mode=clone:${side==='in'?'start':pad}_duration=${seconds-1.2},fps=120`,'-an','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','22000000','-t',String(seconds),'-y',resolve(assets,side+'.mp4')]);
  }
 }
 const to=v=>({x:v.x,y:v.y,z:v.z,rotationX:v.rx,rotationY:v.ry,scale:.66});
 writeFileSync(resolve(part,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi · Mo接力 ${i}</title><script src="assets/gsap.min.js"></script><script src="assets/native.js"></script><link rel="stylesheet" href="assets/native.css"><link rel="stylesheet" href="assets/palettes.css"><style>
@font-face{font-family:MoSans;src:url('assets/NotoSansCJKsc-Regular.otf')}@font-face{font-family:MoSans;src:url('assets/NotoSansCJKsc-Bold.otf');font-weight:700 900}@font-face{font-family:MoSerif;src:url('assets/NotoSerifCJKsc-SemiBold.otf')}
*{box-sizing:border-box}body{margin:0}#film{width:2560px;height:1440px;position:relative;overflow:hidden;background:#f5f1e8;color:#2b4036;perspective:2400px}#atmosphere{position:absolute;inset:-35%;background:radial-gradient(ellipse at 40% 65%,${c.tint},#f8f5e9 55%);transform:translateZ(-900px)}.screen{position:absolute;inset:0;transform-origin:50% 50%;overflow:hidden;backface-visibility:hidden;box-shadow:0 60px 100px #354f352d}video{display:block;width:2560px;height:1440px}#incoming{opacity:0}#mo-actor{position:absolute;left:0;top:0;width:420px;height:520px;opacity:0;transform-origin:50% 50%;filter:drop-shadow(0 28px 28px #25372620)}#shadow{position:absolute;left:980px;top:1290px;width:600px;height:55px;border-radius:50%;background:#66785418;filter:blur(16px);opacity:0}#words{position:absolute;left:180px;top:110px;z-index:4;font:900 112px/1.24 MoSans;letter-spacing:-4px;opacity:0}#words span{display:inline-block}#chapter{position:absolute;right:120px;top:105px;font:28px MoSans;opacity:0;color:#617264}.orb-companion__laptop{will-change:transform}#words{${typography}}${i===3?'#mo-actor,#shadow{visibility:hidden}':''}
</style></head><body><main id="film" data-composition-id="mochi-bridge-${i}" data-width="2560" data-height="1440" data-duration="${seconds}" data-fps="120"><div id="atmosphere"></div><div id="outgoing" class="screen"><video id="out-video" class="clip" src="assets/out.mp4" muted data-start="0" data-duration="${seconds}" data-track-index="1"></video></div><div id="incoming" class="screen"><video id="in-video" class="clip" src="assets/in.mp4" muted data-start="0" data-duration="${seconds}" data-track-index="2"></video></div><div id="shadow"></div><div id="mo-actor" data-mochi-pet-palette="caramel"></div><div id="words">${c.title.split('\n').map(l=>Array.from(l).map(ch=>`<span>${ch===' '?'&nbsp;':ch}</span>`).join('')).join('<br>')}</div><div id="chapter">${chapters[i+1].name}</div></main><script>
initMoActor();const tl=gsap.timeline({paused:true});window.__timelines={'mochi-bridge-${i}':tl};
const rest={x:0,y:0,z:0,rotationX:0,rotationY:0,scale:1};
tl.fromTo('#outgoing',rest,{...${JSON.stringify(to(c.old))},duration:1.4,ease:'power3.inOut',immediateRender:false},.15);
tl.fromTo('#incoming',{...${JSON.stringify(to(c.next))},opacity:0},{...${JSON.stringify(to(c.next))},opacity:1,duration:.5,ease:'power2.out',immediateRender:false},1.15);
tl.fromTo('#mo-actor',{x:${i%2?2200:180},y:620,scale:.13,rotation:${i%2?-16:16},opacity:0},{x:${c.mo.x},y:${c.mo.y},scale:1,rotation:0,opacity:1,duration:1.5,ease:'back.out(1.18)',immediateRender:false},.4);
tl.fromTo('#shadow',{scale:.25,opacity:0},{scale:1,opacity:1,duration:1.4,immediateRender:false},.4);
tl.set('#words',{opacity:1},1.1);
${[0,3,5].includes(i)?"tl.fromTo('#words span',{opacity:0},{opacity:1,duration:.035,stagger:.065,ease:'none',immediateRender:false},1.1);":"tl.fromTo('#words span',{y:95,rotation:5,opacity:0},{y:0,rotation:0,opacity:1,duration:.7,stagger:.025,ease:'back.out(1.35)',immediateRender:false},1.1);"}
tl.to('#chapter',{opacity:1,duration:.4},1.5);
${i===2?"tl.fromTo('#incoming',{clipPath:'circle(0% at 50% 50%)'},{clipPath:'circle(100% at 50% 50%)',duration:1.35,ease:'power3.inOut',immediateRender:false},1.15);":''}
${i===4?"tl.fromTo('#incoming',{clipPath:'inset(48% 0% 48% 0%)'},{clipPath:'inset(0% 0% 0% 0%)',duration:1.1,ease:'back.out(1.08)',immediateRender:false},1.15);":''}
${i===5?"tl.fromTo('#incoming',{clipPath:'inset(30% 18% 30% 18% round 100px)'},{clipPath:'inset(0% 0% 0% 0% round 0px)',duration:1.5,ease:'power3.inOut',immediateRender:false},1.15);":''}

tl.to('#atmosphere',{x:${i%2?-200:200},y:120,duration:6,ease:'sine.inOut'},0);
tl.to('#mo-actor',{y:${c.mo.y-50},rotation:-4,duration:.7,ease:'sine.inOut'},2.2).to('#mo-actor',{y:${c.mo.y},rotation:3,duration:.65,ease:'sine.inOut'},2.9);
// Mo leads the lens to the next live product scene; the old one stays in the same space.
tl.to('#words span',{y:-70,rotation:-3,opacity:0,duration:.45,stagger:.012,ease:'power2.in'},3.35);tl.to('#chapter',{opacity:0,duration:.3},3.45);
tl.to('#mo-actor',{x:${i%2?1760:580},y:420,scale:.45,rotation:${i%2?12:-12},duration:1,ease:'power3.inOut'},3.5);
tl.to('#shadow',{scale:.3,opacity:0,duration:.9},3.5);
tl.to('#outgoing',{x:${c.old.x*2.4},y:${c.old.y*1.6},z:-1500,scale:.4,opacity:0,duration:1.5,ease:'power3.inOut'},3.2);
tl.to('#incoming',{...rest,duration:1.6,ease:'power3.inOut'},3.35);
tl.to('#mo-actor',{scale:.12,opacity:0,duration:.65,ease:'power2.in'},4.25);
let time=0;const clock={get time(){return time},set time(v){time=v;paintMo(v,${c.turn}*Math.sin(v*.6))}};tl.to(clock,{time:6,duration:6,ease:'none'},0);
// Retiming changes choreography durations, not the speed of readable source footage.
const retime=${seconds}/6;const children=tl.getChildren(false,true,true).map(t=>({t,start:t.startTime(),duration:t.duration()}));for(const item of children){item.t.startTime(item.start*retime);item.t.duration(item.duration*retime);}
</script></body></html>`);
}
writeFileSync(resolve(dir,'plan.json'),JSON.stringify({handleSeconds:1.2,bridgeDurations,chapters,duration:chapters.reduce((n,c)=>n+c.duration,0)+bridgeDurations.reduce((n,d)=>n+d,0)-directions.length*2.4},null,2)+'\n');

const sources=['client-plugins/jxl-brand/src/OrbCompanion.tsx','client-plugins/jxl-brand/src/ExpressiveOrb.tsx','client-plugins/jxl-brand/src/bloub-motion.ts','client-plugins/jxl-brand/src/vendor/bloub/engine.ts','client-plugins/jxl-brand/src/vendor/bloub/states.ts','client-plugins/jxl-theme/assets/mochi-palettes.json'];
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({character:'Mochi / Mo',hyperframes:'0.8.36',gsap:'3.15.0',sources:sources.map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')}))},null,2)+'\n');
