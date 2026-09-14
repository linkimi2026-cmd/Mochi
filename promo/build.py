from pathlib import Path
import json, hashlib, shutil, re
ROOT=Path(__file__).parent
A=ROOT/'assets'
# A deterministic presentation copy; the model's drawing equations and defaults remain unchanged.
s=(A/'wave-original.html').read_text()
s=s.replace("time += 0.06;", "// Time is supplied by the offline film clock.")
s=s.replace('requestAnimationFrame(animate);','')
s=s.replace('// kick off', 'window.renderFilmFrame = function(t) { time = t * 3.6; animate(); };\n// kick off')
s=s.replace('</style>','html,body{width:1280px;height:720px;overflow:hidden}.app{height:630px;min-height:630px}</style>')
(A/'wave-film.html').write_text(s)
scenes=[
 (0,7,'从一句话开始。','让教学工作，向前一步。','home'),
 (7,18,'校园事务，一问有据。','状态、记录与提醒，在同一处看清。','query'),
 (18,27,'看清事实，再做决定。','已到达，不等于已返班。','query-detail'),
 (27,39,'把想法，变成作品。','从教学内容，到可以打开的文档。','essay'),
 (39,50,'备课成果，接着用。','文字、结构、课件，衔接起来。','deck'),
 (50,63,'让抽象知识，动起来。','Mochi 生成的波的干涉与衍射模型。','wave'),
 (63,75,'行动之前，由你确认。','看清对象、内容与范围，再发起协作。','approval'),
 (75,87,'协作，有来有回。','让各自的 Mochi，成为工作的连接。','relay'),
 (87,100,'从办公桌，走进教室。','教师端与教室端，各有自己的身份。','classroom'),
 (100,108,'不同学科，同一个伙伴。','英语试卷、语文材料、互动模型。','outputs'),
 (108,114,'把时间，留给教学。','校园事务 · 内容制作 · 跨端协作','resolve'),
 (114,120,'Mochi','你的校园工作伙伴','end')]
(ROOT/'timeline.json').write_text(json.dumps({'duration':120,'fps':30,'width':1920,'height':1080,'scenes':[dict(start=a,end=b,title=c,subtitle=d,kind=e) for a,b,c,d,e in scenes]},ensure_ascii=False,indent=2))
parts=[]
for i,(start,end,title,sub,kind) in enumerate(scenes):
 dark=kind in ['wave','approval','relay','classroom','outputs']
 content=''
 if kind=='home':
  content='<div class="hero-word">Mochi<span>校园工作伙伴</span></div><div class="screen hero-screen"><img src="assets/home.png"></div>'
 elif kind=='query':content='<div class="screen wide"><img src="assets/query.png"></div><div class="source-tag">真实界面 · 演示数据</div>'
 elif kind=='query-detail':content='<div class="screen detail"><img src="assets/query.png"></div><div class="side-note"><span>01 / CAMPUS</span><p>保留状态差异，<br>才有判断依据。</p><small>演示数据 · 结果特写</small></div>'
 elif kind=='essay':content='<div class="paper essay"><img src="assets/essay.png"></div><div class="editorial"><span>02 / CREATE</span><h3>一句需求。<br>一份真实成果。</h3><p>《梅影清芬》</p><small>Mochi 生成文档 · 原始 PDF</small></div>'
 elif kind=='deck':content='<div class="screen deck-a"><img src="assets/deck.png"></div><div class="screen deck-b"><img src="assets/deck2.png"></div><div class="source-tag">Mochi 生成课件 · 原始页面</div>'
 elif kind=='wave':content='<div class="screen wave"><iframe id="wave-frame" src="assets/wave-film.html" title="Mochi 生成的交互模型"></iframe></div><div class="source-tag">原始生成模型 · 默认参数运行展示</div>'
 elif kind=='approval':content='<div class="screen approval"><img src="assets/approval.png"></div><div class="trust"><span>03 / COLLABORATE</span><h3>先看清。<br>再确认。</h3><p>AI 执行，人的决定。</p></div><div class="source-tag">真实审批界面 · 独立片段</div>'
 elif kind=='relay':content='<div class="relay-label a">教师的 Mochi</div><div class="relay-label b">同事的 Mochi</div><svg class="connection" viewBox="0 0 1920 1080"><path id="route" d="M 390 560 C 720 330 1170 770 1530 550" fill="none" stroke="#769784" stroke-width="3"/><path d="M 390 578 C 720 348 1170 788 1530 568" fill="none" stroke="#344b40" stroke-width="1"/></svg><img class="relay-icon left" src="assets/icon.png"><img class="relay-icon right" src="assets/icon.png"><img class="courier" src="assets/icon.png"><div class="relay-caption">发起请求<span>确认范围</span>回应结果</div><div class="source-tag">协作关系示意 · 非实时传输录屏</div>'
 elif kind=='classroom':content='<div class="screen classroom"><img src="assets/classroom.png"></div><div class="trust classroom-note"><span>04 / CLASSROOM</span><h3>一端准备。<br>一端呈现。</h3><p>教师电脑 → 教室一体机</p><small>Windows · macOS</small></div><div class="source-tag">真实教室连接界面 · 身份设置页</div>'
 elif kind=='outputs':content='<div class="paper out-english"><img src="assets/english.png"></div><div class="paper out-essay"><img src="assets/essay.png"></div><div class="screen out-deck"><img src="assets/deck2.png"></div><div class="source-tag">Mochi 实际生成成果</div>'
 elif kind=='resolve':content='<div class="screen resolve-screen"><img src="assets/home.png"></div><div class="resolve-text">把时间，<br>留给教学。</div>'
 elif kind=='end':content='<img class="end-icon" src="assets/icon.png"><div class="end-word">Mochi</div><div class="end-tag">你的校园工作伙伴</div><div class="end-footer">让教学工作，向前一步。</div>'
 header='' if kind in ['home','resolve','end'] else f'<header><div class="chapter">MOCHI / {i:02d}</div><h2>{title}</h2><p>{sub}</p></header>'
 parts.append(f'<section id="s{i}" class="clip scene {"dark" if dark else "light"} {kind}-scene" data-start="{start}" data-duration="{end-start}" data-track-index="{i}">{header}{content}</section>')
css='''
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f6f4ed;font-family:"PingFang SC","Helvetica Neue",sans-serif}#stage{position:relative;width:1920px;height:1080px;overflow:hidden}.scene{position:absolute;inset:0;overflow:hidden;background:#f6f4ed;color:#243f33}.scene.dark{background:#13271f;color:#f5f2e8}.scene:before{content:"";position:absolute;width:1100px;height:1000px;left:1000px;top:-400px;background:radial-gradient(ellipse,rgba(154,181,137,.19),transparent 68%);pointer-events:none}header{position:absolute;left:112px;top:67px;z-index:3}.chapter{font-size:17px;letter-spacing:4px;color:#6c8c78;margin-bottom:20px}h2{font-size:55px;font-weight:550;letter-spacing:-2px;margin:0 0 14px}header p{font-size:24px;color:#688072;margin:0}.dark header p{color:#bdcdbf}.screen{position:absolute;overflow:hidden;border-radius:18px;box-shadow:0 28px 70px #10271b26;background:#f5f2e8;border:1px solid #7b958440}.screen img{display:block;width:100%;height:auto}.hero-word{position:absolute;left:112px;top:137px;font-size:170px;font-weight:550;letter-spacing:-9px;line-height:1}.hero-word span{display:block;font-size:28px;letter-spacing:3px;margin-top:35px;font-weight:400}.hero-screen{left:635px;top:180px;width:1440px;height:810px;transform-origin:50% 50%}.wide{left:305px;top:290px;width:1310px;height:737px}.source-tag{position:absolute;bottom:24px;right:110px;font-size:16px;letter-spacing:1px;color:#6b8074}.dark .source-tag{color:#aec4b5}.detail{left:680px;top:245px;width:1130px;height:690px}.detail img{position:absolute;width:2290px;max-width:none;left:-665px;top:-392px}.side-note{position:absolute;left:112px;top:420px;width:440px}.side-note span,.editorial span,.trust span{font-size:18px;letter-spacing:3px;color:#779681}.side-note p{font-size:42px;line-height:1.6;font-weight:500}.side-note small,.editorial small,.trust small{font-size:19px;color:#6b8074}.paper{position:absolute;background:white;box-shadow:0 25px 70px #0920142b;overflow:hidden}.paper img{width:100%;display:block}.essay{left:1040px;top:238px;width:670px;height:925px}.editorial{position:absolute;left:112px;top:380px}.editorial h3,.trust h3{font-size:66px;line-height:1.35;letter-spacing:-2px;font-weight:500;margin:26px 0}.editorial p,.trust p{font-size:28px}.deck-a{left:113px;top:338px;width:1080px;height:607px}.deck-b{left:800px;top:425px;width:1010px;height:568px}.wave{left:290px;top:279px;width:1340px;height:754px;background:#0a0e1a}.wave iframe{width:1280px;height:720px;border:0;transform:scale(1.046875);transform-origin:0 0}.approval{left:720px;top:318px;width:1080px;height:620px;border-color:#977441}.approval img{position:absolute;width:1420px;left:-650px;top:-610px;max-width:none}.trust{position:absolute;left:112px;top:396px}.trust p{color:#c1d1c4;font-size:24px}.connection{position:absolute;inset:0;width:1920px;height:1080px}.relay-label{position:absolute;top:386px;font-size:28px;color:#d2ded3}.relay-label.a{left:234px}.relay-label.b{left:1430px}.relay-icon{position:absolute;top:469px;width:150px;height:150px;border-radius:34px}.relay-icon.left{left:250px}.relay-icon.right{left:1520px}.courier{position:absolute;left:345px;top:515px;width:90px;height:90px;border-radius:22px}.relay-caption{position:absolute;top:814px;left:505px;font-size:29px;letter-spacing:2px;display:flex;gap:156px;color:#d6e0d4}.classroom{left:800px;top:290px;width:1000px;height:724px}.classroom img{position:absolute;width:1380px;left:-230px;top:-10px}.classroom-note{top:410px}.classroom-note h3{font-size:62px}.classroom-note small{color:#b7caba}.out-english{left:180px;top:360px;width:520px;height:800px}.out-essay{left:720px;top:315px;width:490px;height:800px}.out-deck{left:1140px;top:450px;width:690px;height:388px}.resolve-screen{left:825px;top:180px;width:1280px;height:720px}.resolve-text{position:absolute;left:112px;top:310px;font-size:104px;font-weight:550;line-height:1.4;letter-spacing:-5px}.end-icon{position:absolute;left:451px;top:341px;width:212px;height:212px;border-radius:46px;box-shadow:0 20px 80px #8b926d22}.end-word{position:absolute;left:721px;top:300px;font-size:180px;font-weight:500;letter-spacing:-10px}.end-tag{position:absolute;left:736px;top:536px;font-size:36px;letter-spacing:5px}.end-footer{position:absolute;left:0;top:820px;width:1920px;text-align:center;font-size:25px;letter-spacing:3px;color:#6c8271}.brand{position:absolute;left:112px;bottom:26px;font-size:15px;letter-spacing:4px;color:#829584;z-index:50;pointer-events:none}
'''
js='''
window.__timelines=window.__timelines||{};
const tl=gsap.timeline({paused:true,defaults:{ease:"power2.inOut"}});
const scenes=SCENES;
for(let i=0;i<scenes.length;i++){
 const s=scenes[i],el=document.querySelector('#s'+i);
 tl.fromTo(el,{opacity:0},{opacity:1,duration:i===0?.7:.45},s.start);
 if(i<scenes.length-1)tl.to(el,{opacity:0,duration:.35},s.end-.35);
 const h=el.querySelector('header');if(h)tl.fromTo(h,{y:22,opacity:0},{y:0,opacity:1,duration:.65},s.start+.2);
}
tl.fromTo('.hero-screen',{x:260,y:80,rotation:4,scale:.92},{x:0,y:0,rotation:0,scale:1,duration:1.8},0);
tl.fromTo('.hero-word',{y:40,opacity:0},{y:0,opacity:1,duration:1},.35);
tl.fromTo('.wide',{y:65,scale:.93},{y:0,scale:1,duration:.8},7.15);
tl.fromTo('.detail',{x:70,opacity:0},{x:0,opacity:1,duration:.8},18.15);
tl.fromTo('.essay',{y:155,rotation:5},{y:0,rotation:0,duration:1.3},27.2);
tl.fromTo('.deck-a',{x:-170,y:35,rotation:-4},{x:0,y:0,rotation:0,duration:1.1},39.2);
tl.fromTo('.deck-b',{x:300,y:80,rotation:5},{x:0,y:0,rotation:0,duration:1.2},42.2);
tl.fromTo('.wave',{y:75,scale:.94},{y:0,scale:1,duration:.85},50.15);
tl.fromTo('.approval',{x:100,y:20},{x:0,y:0,duration:.75},63.15);
tl.fromTo('#route',{strokeDasharray:1500,strokeDashoffset:1500},{strokeDashoffset:0,duration:2.2,ease:'power1.inOut'},76);
tl.fromTo('.courier',{x:0,y:0,opacity:0},{opacity:1,duration:.2},76);
tl.to('.courier',{x:570,y:-65,duration:1.1,ease:'power1.in'},76);
tl.to('.courier',{x:1140,y:-10,duration:1.1,ease:'power1.out'},77.1);
tl.to('.courier',{opacity:0,duration:.25},78.2);
tl.fromTo('.relay-caption',{y:15,opacity:0},{y:0,opacity:1,duration:.6},79);
tl.fromTo('.classroom',{x:140,scale:.94},{x:0,scale:1,duration:1.1},87.2);
tl.fromTo('.out-english',{y:140,rotation:-4},{y:0,rotation:-2,duration:1.1},100.2);
tl.fromTo('.out-essay',{y:200,rotation:5},{y:0,rotation:2,duration:1.2},100.5);
tl.fromTo('.out-deck',{x:140,rotation:3},{x:0,rotation:0,duration:1.1},100.85);
tl.fromTo('.resolve-screen',{x:180,y:20,opacity:0},{x:0,y:0,opacity:1,duration:1.1},108.2);
tl.fromTo('.resolve-text',{y:35,opacity:0},{y:0,opacity:1,duration:1},108.2);
tl.fromTo('.end-icon',{y:45,opacity:0},{y:0,opacity:1,duration:.8},114.2);
tl.fromTo('.end-word,.end-tag',{y:25,opacity:0},{y:0,opacity:1,duration:.8,stagger:.18},114.6);
tl.fromTo('.end-footer',{opacity:0},{opacity:1,duration:.65},115.8);
tl.to({hold:0},{hold:1,duration:3},117);
const wave=document.getElementById('wave-frame');
tl.eventCallback('onUpdate',()=>{try{wave.contentWindow.renderFilmFrame?.(Math.max(0,tl.time()-50));}catch(e){}});
window.__timelines['mochi-film']=tl;
'''.replace('SCENES',json.dumps([dict(start=a,end=b) for a,b,*_ in scenes]))
html='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>Mochi · 120 秒产品介绍</title><style>'+css+'</style><script src="assets/gsap.min.js"></script></head><body><div id="stage" data-composition-id="mochi-film" data-width="1920" data-height="1080" data-duration="120" data-fps="30">'+''.join(parts)+'<div class="brand">MOCHI · 校园工作伙伴</div><audio id="score" src="assets/score.wav" data-start="0" data-duration="120" data-track-index="20"></audio></div><script>'+js+'</script></body></html>'
(ROOT/'index.html').write_text(html)
manifest=[]
for p in A.iterdir():
 if p.is_file():manifest.append({'file':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(ROOT/'evidence/assets.json').write_text(json.dumps(manifest,indent=2))
