import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),assets=resolve(dir,'supplement/assets');
mkdirSync(assets,{recursive:true});
const shots=[
 ['campus-find-release',2,6,'2560:1220:0:170','校园里的工作，继续连接。','嘉行联真实网站 · 独立后端 · 隔离演示数据'],
 ['campus-find-release',63,6,'1640:650:640:680','找到那位同学。','按演示学号查询 · 只显示授权范围内的信息'],
 ['campus-find-release',77,6,'1660:900:630:470','再看清他的状态。','学生档案与到访记录'],
 ['campus-find-release',118,6,'2100:1200:430:180','一项申请，明确去向。','选择学生、目的地与预计到达时间'],
 ['campus-find-release',132,6,'2080:1150:430:210','登记之后，交给审批。','真实登记操作 · 学生放行流程'],
 ['campus-find-release',148,6,'2080:1150:430:210','每一步，都有明确状态。','本次原片止于待审批 · 尚未正式放行'],
 ['journal-memory-clean',33,8,'1340:1280:420:105','今天的交流，留下来。','Mochi 日记 · 来自已有真实活动记录'],
 ['journal-memory-clean',52,6,'1340:1280:420:105','记住，也能说明依据。','展开来源 · 回到那次交流'],
 ['journal-memory-clean',66,8,'1340:1230:420:155','慢慢了解你的习惯。','偏好与观察 · 记忆内容可查看'],
 ['journal-memory-clean',77,6,'1340:1280:420:105','决定权，始终在你。','查看更正表单 · 本镜头没有提交修改'],
 ['history-automation-clean',48,8,'1340:1280:420:105','把经历，串成一段历史。','本机日记摘录预览 · 保留来源'],
 ['history-automation-clean',6,6,'2160:1360:0:65','约定好，再按时出现。','自动化任务 · 已有一次性规则'],
 ['history-automation-clean',17,6,'2160:1360:0:65','执行之后，也有记录。','10 月 2 日既有运行历史 · 不是新触发'],
];
for(const [i,s] of shots.entries()){
 execFileSync('ffmpeg',['-v','error','-ss',String(s[1]),'-i',resolve(dir,`../capture-private.nosync/${s[0]}.mov`),'-t',String(s[2]),'-vf',`crop=${s[3]},fps=60,setsar=1`,'-an','-c:v','libx264','-crf','17','-preset','ultrafast','-g','30','-y',resolve(assets,`shot-${i}.mp4`)],{stdio:'inherit'});
 console.log(`prepared ${i+1}/${shots.length}`);
}
for(const name of ['gsap.min.js','motion.js','motion.css','native.js','native.css','palettes.css','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf'])copyFileSync(resolve(dir,'../team-chapter/assets',name),resolve(assets,name));
let at=0;const manifest=shots.map((s,i)=>{const o={id:i,source:s[0],sourceStart:s[1],duration:s[2],crop:s[3],title:s[4],note:s[5],start:at};at+=s[2];return o});
writeFileSync(resolve(dir,'supplement/shots.json'),JSON.stringify(manifest,null,2)+'\n');
const scenes=manifest.map(s=>`<section id="scene-${s.id}" class="scene"><div class="copy"><div class="chapter">${s.id<6?'连接校园':s.id<11?'一起积累':'按时行动'}</div><h2>${s.title}</h2><p>${s.note}</p></div><div class="camera"><video id="shot-${s.id}" class="clip" src="assets/shot-${s.id}.mp4" muted playsinline data-start="${s.start}" data-duration="${s.duration}" data-track-index="1"></video></div></section>`).join('\n');
writeFileSync(resolve(dir,'supplement/index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi · 校园与日常</title><script src="assets/gsap.min.js"></script><script src="assets/motion.js"></script><script src="assets/native.js"></script><link rel="stylesheet" href="assets/motion.css"><link rel="stylesheet" href="assets/native.css"><link rel="stylesheet" href="assets/palettes.css"><style>
@font-face{font-family:Mo;src:url('assets/NotoSansCJKsc-Regular.otf')}@font-face{font-family:Mo;src:url('assets/NotoSansCJKsc-Bold.otf');font-weight:700}@font-face{font-family:Serif;src:url('assets/NotoSerifCJKsc-SemiBold.otf')}
*{box-sizing:border-box}body{margin:0;color:#2c463d;font-family:Mo}#film{width:2560px;height:1440px;overflow:hidden;position:relative;background:#f5f1e8}.scene{position:absolute;inset:0;opacity:0}.copy{position:absolute;left:135px;top:230px;width:790px;z-index:2}.chapter{font:28px Mo;color:#7b6948;letter-spacing:8px}h2{font:700 96px/1.4 Mo;letter-spacing:-4px;margin:40px 0}.copy p{font:32px/1.8 Mo;max-width:680px;color:#647368}.glyph{display:inline-block}.camera{position:absolute;left:1000px;top:180px;width:1440px;height:1110px;transform-origin:50% 50%;display:flex;align-items:center;justify-content:center}.camera video{width:100%;max-height:1110px;object-fit:contain;border-radius:20px;box-shadow:0 32px 100px #3645371e}.wash{position:absolute;inset:0;background:radial-gradient(ellipse at 15% 70%,#d5e5d0aa,transparent 60%),radial-gradient(ellipse at 85% 20%,#f5d7b780,transparent 60%)}#outro{position:absolute;inset:0;opacity:0;text-align:center}#characters{position:absolute;left:1070px;top:260px;width:420px;height:420px}.character p{display:none}.character:not(:first-child){display:none}#outro h1{position:absolute;top:700px;left:0;width:100%;font:700 156px Mo;letter-spacing:-8px;margin:0}#outro p{position:absolute;top:970px;left:0;width:100%;font:48px Mo;margin:0}#outro small{position:absolute;top:1120px;left:0;width:100%;font:28px Mo;color:#687566}
</style></head><body><main id="film" data-composition-id="mochi-continuation" data-width="2560" data-height="1440" data-fps="120"><div class="wash"></div>${scenes}<section id="outro"><div id="characters"></div><h1>Mochi 已至。</h1><p>让校园里的工作，自然连接。</p><small>第一版联片 · 供审片</small></section></main><script>
initTeamPalette();const tl=gsap.timeline({paused:true});window.__timelines={'mochi-continuation':tl};const shots=${JSON.stringify(manifest)};
for(const s of shots){const el=document.querySelector('#scene-'+s.id),copy=el.querySelector('.copy'),camera=el.querySelector('.camera'),h=el.querySelector('h2');h.innerHTML=s.title.split(/(?<=，)/).map(part=>'<span style="display:block;white-space:nowrap">'+[...part].map(c=>'<span class="glyph">'+c+'</span>').join('')+'</span>').join('');const right=s.id%3===2;if(right){gsap.set(copy,{x:1490});gsap.set(camera,{x:-900});h.style.fontFamily='Serif';h.style.fontWeight='600'}
tl.set(el,{opacity:1},s.start);tl.fromTo(camera,{y:140,scale:.93,rotation:s.id%2?2:-2,opacity:0},{y:0,scale:1,rotation:0,opacity:1,duration:.8,ease:'back.out(1.1)',immediateRender:false},s.start);
tl.fromTo(h.querySelectorAll('.glyph'),{y:60,opacity:0},{y:0,opacity:1,duration:.6,stagger:.025,ease:'back.out(1.3)',immediateRender:false},s.start+.1);tl.fromTo(el.querySelector('p'),{y:20,opacity:0},{y:0,opacity:1,duration:.5,immediateRender:false},s.start+.8);
tl.to(camera,{scale:1.055,y:-18,duration:s.duration-1.4,ease:'sine.inOut'},s.start+.9);tl.to(el,{y:s.id%2? -65:65,opacity:0,duration:.35,ease:'power2.in'},s.start+s.duration-.35);tl.set(el,{opacity:0},s.start+s.duration);
}
tl.to('.wash',{x:80,y:-40,scale:1.12,duration:${at+8},ease:'none'},0);
tl.set('#outro',{opacity:1},${at});tl.fromTo('#characters',{scale:.2,y:300,rotation:-12},{scale:1.4,y:0,rotation:0,duration:1.4,ease:'elastic.out(1,.7)',immediateRender:false},${at});tl.fromTo('#outro h1',{y:100,opacity:0},{y:0,opacity:1,duration:1,ease:'back.out(1.3)',immediateRender:false},${at+.6});tl.fromTo('#outro p,#outro small',{y:35,opacity:0},{y:0,opacity:1,stagger:.3,duration:.8,immediateRender:false},${at+1.5});let t=0;const clock={get time(){return t},set time(v){t=v;paintCharacters(v)}};tl.to(clock,{time:${at+8},duration:${at+8},ease:'none'},0);
</script></body></html>`);
console.log('duration',at+8);
