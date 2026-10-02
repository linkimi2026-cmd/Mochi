import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),old=resolve(dir,'../team-chapter');mkdirSync(resolve(dir,'assets'),{recursive:true});
for(const n of ['gsap.min.js','motion.js','motion.css','native.css','native.js','palettes.css','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf','roster.mp4','plan.mp4','deck.mp4','music-review.wav']){const p=resolve(dir,'assets',n);if(!existsSync(p))symlinkSync(resolve(old,'assets',n),p)}
let html=readFileSync(resolve(old,'index.html'),'utf8');
html=html.replace('mochi-team','mochi-team-dialogue').replace("'mochi-team':tl","'mochi-team-dialogue':tl");
html=html.replace('各自分工，<br>汇成一份成果。','教案成员，<br>展开教学思路。').replace('过程可见。<br>成果可核验。','课件成员，<br>接着把课堂做出来。');
html=html.replace('#plan-title{left:1750px;top:860px;width:700px;font:700 78px/1.4 MoSans}', '#plan-title{left:1660px;top:490px;width:760px;font:700 85px/1.4 MoSans}');
html=html.replace('#deck-title{left:130px;top:260px;width:700px;font:600 98px/1.4 MoSerif}', '#deck-title{left:120px;top:210px;width:780px;font:800 84px/1.4 MoSans}');
html=html.replace('id="plan-video" class="clip" src="assets/plan.mp4" muted data-start="5" data-duration="7" data-track-index="1"','id="plan-video" class="clip" src="assets/plan.mp4" muted data-start="5" data-duration="14" data-track-index="2"');
html=html.replace("tl.to('#plan-camera',{y:-980,rotation:-4,opacity:0,duration:.75,ease:'power3.in'},11.25);tl.set('#plan-camera',{opacity:0},12);", "tl.to('#plan-camera',{x:145,y:815,scale:.28,rotation:-3,opacity:.72,duration:1.05,ease:'power3.inOut'},11.25);tl.to('#plan-camera',{y:1600,opacity:0,duration:.8,ease:'power3.in'},18.2);");
html=html.replace("{x:1070,y:1480,scale:.75},{x:920,y:215,scale:.7},11.75,.8", "{x:2450,y:460,scale:.35,rotation:7},{x:950,y:310,scale:.68,rotation:0},11.65,1.2,'back.out(1.1)'");
// Pointer uses revised camera geometry at the original recorded expansion time.
html=html.replaceAll('{x:1275,y:745}','{x:1295,y:825}');
html=html.replace('真实协作历史 · 三位子 Agent · 当前均已停止运行','真实协作历史回放 · 原成员会话 · 并非新增群聊界面');
writeFileSync(resolve(dir,'index.html'),html);
