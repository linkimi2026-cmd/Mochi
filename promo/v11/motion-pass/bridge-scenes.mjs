// Editorial transitions over unchanged product footage; each scene has its own spatial verb.
import {readFileSync,writeFileSync,copyFileSync,existsSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const plan=JSON.parse(readFileSync(resolve(dir,'plan.json')));
const scenes=[
 {name:'同一空间，展开团队',title:'一个想法。<br>一起完成。',pose:'left:170px;top:90px;font-size:110px',color:'#dce8d1',type:'lateral'},
 {name:'成果环绕，进入作品',title:'分工，<br>成为作品。',pose:'left:165px;top:105px;font-size:120px',color:'#f1d8b9',type:'gallery'},
 {name:'纸面折起，穿入模型',title:'让想法<br><em>动起来。</em>',pose:'left:170px;top:80px;font-size:110px',color:'#dae7de',type:'portal'},
 null,
 {name:'信件飞过，两端相连',title:'一封信。<br>校园，就近了一点。',pose:'left:150px;top:70px;font-size:90px',color:'#dce8d7',type:'courier'},
 {name:'聚焦问题，进入对话',title:'同学在哪里？',pose:'left:1430px;top:90px;font-size:96px',color:'#eadcc7',type:'focus'},
 {name:'今天翻过，记忆延续',title:'接住今天。<br><em>也记得明天。</em>',pose:'left:1280px;top:100px;font-size:96px',color:'#d9e5dc',type:'vertical'},
];
for(const [i,scene] of scenes.entries()){
 if(!scene)continue;
 const part=resolve(dir,'bridges',String(i)),assets=resolve(part,'assets'),seconds=plan.bridgeDurations[i];
 if(i===4)execFileSync('ffmpeg',['-v','error','-sseof','-0.1','-i',resolve(dir,'../mailbox-chapter/output/mailbox-review.mp4'),'-frames:v','1','-y',resolve(assets,'mail-source.png')]);
 for(const n of ['paper-transfer.js','paper-transfer.css'])copyFileSync(resolve(dir,'..',n),resolve(assets,n));
 for(const [j,name] of ['lesson-revised-1.png','lesson-revised-3.png','lesson-revised-5.png'].entries()){
  const dest=resolve(assets,`work-${j}.png`);if(!existsSync(dest))symlinkSync(resolve(dir,'../teaching-chapter/assets',name),dest);
 }
 const art=Array.from({length:[1,2,6].includes(i)?6:0},(_,j)=>`<img class="work work-${j}" src="assets/work-${j%3}.png" alt=""/>`).join('');
 let choreography='';
 if(scene.type==='lateral')choreography=`
  tl.to('#outgoing',{x:-930,y:60,scale:.43,rotation:-5,duration:d*.3,ease:'power3.inOut'},d*.035);
  tl.fromTo('#incoming',{x:1750,y:420,scale:.48,rotation:8},{x:850,y:200,scale:.48,rotation:0,duration:d*.35,ease:'power3.out'},d*.08);
  tl.to('#outgoing',{x:-2800,y:-140,rotation:-12,duration:d*.4,ease:'power3.inOut'},d*.52);
  tl.to('#incoming',{...rest,duration:d*.38,ease:'power3.inOut'},d*.59);
  actor(50,1010,1760,940,2250,720);
 `;
 if(scene.type==='gallery')choreography=`
  tl.to('#outgoing',{x:850,y:-450,scale:.30,rotation:5,duration:d*.32,ease:'power3.inOut'},d*.02);
  tl.fromTo('#incoming',{x:680,y:950,scale:.48,rotation:-7},{x:600,y:380,scale:.48,rotation:0,duration:d*.38,ease:'power3.out'},d*.09);
  tl.to('#outgoing',{x:1050,y:-1650,rotation:12,duration:d*.4,ease:'power3.inOut'},d*.5);
  tl.to('#incoming',{...rest,duration:d*.38,ease:'power3.inOut'},d*.59);
  actor(60,1080,550,930,1050,640);
 `;
 if(scene.type==='portal')choreography=`
  tl.to('#outgoing',{x:-1050,y:500,scale:.36,rotationY:-58,rotation:-8,duration:d*.37,ease:'power3.inOut'},d*.025);
  tl.fromTo('#incoming',{x:0,y:0,scale:1,clipPath:'circle(0% at 72% 59%)'},{clipPath:'circle(24% at 72% 59%)',duration:d*.35,ease:'power3.out'},d*.13);
  tl.to('#incoming',{clipPath:'circle(130% at 72% 59%)',duration:d*.37,ease:'power3.inOut'},d*.6);
  tl.to('#outgoing',{x:-2400,rotationY:-75,opacity:0,duration:d*.32},d*.5);
  actor(150,1010,1420,1040,2250,1000);
 `;
 if(scene.type==='courier')choreography=`
  tl.to('#outgoing',{x:-840,y:120,scale:.48,rotationY:12,duration:d*.3,ease:'power3.inOut'},d*.03);
  tl.fromTo('#incoming',{x:2550,y:190,scale:.62,rotationY:-15},{x:980,y:190,scale:.62,rotationY:0,duration:d*.4,ease:'power3.out'},d*.05);
  tl.to('#outgoing',{x:-3000,rotationY:0,duration:d*.39,ease:'power3.inOut'},d*.55);
  tl.to('#incoming',{...rest,duration:d*.4,ease:'power3.inOut'},d*.57);
  const seed=document.querySelector('#paper-seed');
  MochiPaper.transfer(tl,{stage:document.querySelector('#film'),source:seed,at:d*.03,from:{x:430,y:810},to:{x:2100,y:640},duration:d*.42,form:'envelope'});
  actor(50,1100,920,1080,1880,920);
 `;
 if(scene.type==='focus')choreography=`
  tl.to('#outgoing',{x:-660,y:-480,scale:.52,rotation:-5,duration:d*.32,ease:'power3.inOut'},d*.02);
  tl.fromTo('#incoming',{x:0,y:0,clipPath:'inset(55% 55% 45% 10% round 80px)'},{clipPath:'inset(26% 8% 18% 8% round 60px)',duration:d*.36,ease:'power3.out'},d*.12);
  tl.to('#incoming',{clipPath:'inset(0% 0% 0% 0% round 0px)',duration:d*.35,ease:'power3.inOut'},d*.62);
  tl.to('#outgoing',{x:-1700,y:-1600,scale:.3,duration:d*.38},d*.49);
  actor(2100,1030,1770,1070,2250,1120);
 `;
 if(scene.type==='vertical')choreography=`
  tl.to('#outgoing',{x:-690,y:-550,scale:.44,rotation:-7,duration:d*.32,ease:'power3.inOut'},d*.02);
  tl.fromTo('#incoming',{x:-560,y:1650,scale:.54,rotation:7},{x:-540,y:460,scale:.54,rotation:0,duration:d*.38,ease:'power3.out'},d*.1);
  tl.to('#outgoing',{y:-2500,rotation:-14,duration:d*.39,ease:'power3.inOut'},d*.52);
  tl.to('#incoming',{...rest,duration:d*.38,ease:'power3.inOut'},d*.59);
  actor(1920,1160,1940,780,2240,260);
 `;
 writeFileSync(resolve(part,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${scene.name}</title><script src="assets/gsap.min.js"></script><script src="assets/native.js"></script><script src="assets/paper-transfer.js"></script><link rel="stylesheet" href="assets/native.css"><link rel="stylesheet" href="assets/palettes.css"><link rel="stylesheet" href="assets/paper-transfer.css"><style>
 @font-face{font-family:Mo;src:url('assets/NotoSansCJKsc-Bold.otf');font-weight:700 900}@font-face{font-family:MoSerif;src:url('assets/NotoSerifCJKsc-SemiBold.otf')}
 *{box-sizing:border-box}body{margin:0}#film{position:relative;width:2560px;height:1440px;overflow:hidden;background:#f5f1e8;color:#294138;perspective:2400px}#world{position:absolute;inset:-20%;background:radial-gradient(ellipse at 70% 20%,${scene.color},transparent 55%),radial-gradient(ellipse at 25% 90%,#e8dfcc,transparent 60%)}#art{position:absolute;inset:0;opacity:0;mask-image:linear-gradient(transparent 0%,transparent 29%,#000 49%)}.work{position:absolute;width:650px;box-shadow:0 24px 55px #263e3020;opacity:.82}.screen{position:absolute;inset:0;transform-origin:50% 50%;backface-visibility:hidden;overflow:hidden;box-shadow:0 35px 90px #2d493326}video{width:2560px;height:1440px;display:block}#incoming{opacity:0}#mo-actor{position:absolute;left:0;top:0;width:420px;height:520px;opacity:0;z-index:6;filter:drop-shadow(0 22px 28px #33432b20)}#mo-actor .orb-companion__laptop{display:none}#words{position:absolute;${scene.pose};font-family:Mo;font-weight:900;line-height:1.22;letter-spacing:-4px;margin:0;z-index:5;opacity:0}#words em{font-family:MoSerif;font-style:normal;font-weight:600}.glyph{display:inline-block}#paper-seed{position:absolute;left:-4000px;width:650px}#paper-seed img{width:650px}.courier-content{margin:0!important;width:700px!important}.courier-content img{width:700px!important}
 </style></head><body><main id="film" data-composition-id="mochi-bridge-${i}" data-width="2560" data-height="1440" data-duration="${seconds}" data-fps="120"><div id="world"></div><div id="art">${art}</div><div id="outgoing" class="screen"><video id="out-video" class="clip" src="assets/out.mp4" muted data-start="0" data-duration="${seconds}" data-track-index="1"></video></div><div id="incoming" class="screen"><video id="in-video" class="clip" src="assets/in.mp4" muted data-start="0" data-duration="${seconds}" data-track-index="2"></video></div><h1 id="words">${scene.title}</h1><div id="mo-actor" data-mochi-pet-palette="caramel"></div>${i===4?'<div id="paper-seed"><img src="assets/mail-source.png"/></div>':''}</main><script>
 initMoActor();const d=${seconds},tl=gsap.timeline({paused:true});window.__timelines={'mochi-bridge-${i}':tl};const rest={x:0,y:0,scale:1,rotation:0,rotationX:0,rotationY:0};
 const heading=document.querySelector('#words');for(const n of [...heading.childNodes,...heading.querySelectorAll('em')].flatMap(n=>n.nodeType===3?[n]:n.tagName==='EM'?[...n.childNodes]:[]).flat()){if(n.nodeType!==3)continue;const f=document.createDocumentFragment();for(const c of n.textContent){const s=document.createElement('span');s.className='glyph';s.textContent=c;f.append(s)}n.replaceWith(f)}
 ${i===1?"tl.to('#incoming',{opacity:1,duration:d*.12,ease:'power2.out'},d*.5);":"tl.set('#incoming',{opacity:1},d*.06);"}
 function actor(x0,y0,x1,y1,x2,y2){tl.fromTo('#mo-actor',{x:x0,y:y0,scale:.18,rotation:-42,opacity:0},{x:x1,y:y1,scale:.55,rotation:0,opacity:1,duration:d*.38,ease:'power3.out',immediateRender:false},d*.08).to('#mo-actor',{x:x2,y:y2,scale:.2,rotation:32,opacity:0,duration:d*.34,ease:'power3.in'},d*.56)}
 ${choreography}
 tl.fromTo('#world',{x:-60,y:30,scale:1},{x:100,y:-100,scale:1.13,duration:d,ease:'sine.inOut'},0);
 tl.to('#art',{opacity:1,duration:d*.14},d*.12).to('#art',{opacity:0,duration:d*.15},d*.71);
 document.querySelectorAll('.work').forEach((e,j)=>{const col=j%3,row=Math.floor(j/3),x=[-180,920,2020][col],y=row*800-170;
 tl.fromTo(e,{x,y:y+(col===1?-380:450),rotation:(j%2?8:-9),scale:.8},{x:x+(col-1)*120,y:y+(col===1?550:-470),rotation:j%2?1:-2,scale:1,duration:d,ease:'sine.inOut',immediateRender:false},0)});
 tl.set('#words',{opacity:1},d*.21).fromTo('#words .glyph',{y:55,rotation:3,opacity:0},{y:0,rotation:0,opacity:1,duration:d*.16,stagger:.014,ease:'back.out(1.15)',immediateRender:false},d*.21);
 tl.to('#words',{y:-45,opacity:0,duration:d*.15,ease:'power2.in'},d*.58);
 let time=0;const clock={get time(){return time},set time(v){time=v;paintMo(v,18*Math.sin(v*.8))}};tl.to(clock,{time:d,duration:d,ease:'none'},0);
 </script></body></html>`.replace(/[ \t]+$/gm,''));
}
writeFileSync(resolve(dir,'transition-design.json'),JSON.stringify({edition:6,reference:'Desktop K2.6 and K3, inspected with overview and 0.2s transition samples',unchangedTiming:true,scenes:scenes.map((s,i)=>s?{bridge:i,...s}:{bridge:i,preserved:'Existing envelope delivery and ding-dong continuity'})},null,2)+'\n');
