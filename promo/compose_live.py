from pathlib import Path
import json,shutil
B=Path(__file__).resolve().parent;M=json.loads((B/'assets/live/edit-map.json').read_text())
S=[('intro',0,3,'明天，要把这节课讲清楚。','Mochi · 校园工作的 AI 伙伴'),('home',3,4,'从一个工作区开始','任务和文件，放在一起'),('setup',7,5,'进入工作模式','教学生成演示 · 选择完全权限'),('model',12,10,'先让概念，变得可以动手','点击切换三种三角形，边看边讲'),('typing',22,7,'再让讲解，接上练习','继续输入需求，点击发送'),('generation',29,10,'Mochi 开始生成','真实过程加速节选 · 本次生成用时 1 分 08 秒'),('quiz',39,10,'每一次判断，都有反馈','答对有解释，答错也知道为什么'),('campus',49,6,'课堂之外，班级工作也在这里','今日待办与学生档案 · 演示数据'),('ask',55,15,'“她在不在校，在哪里？”','直接问 Mochi · 查询登记状态与到达记录'),('approve',70,18,'“批准这条放行申请。”','核对学生与目的地 → 点击确认 → 真实放行结果'),('a2asend',88,14,'需要协作，就让 Mochi 去问','Agent to Agent · 教师 Mochi → 管理员 Mochi'),('a2areply',102,16,'对方的 Mochi 接住请求','接收方确认后回话 · 已送达与已答应分开记录'),('a2areturn',118,15,'一句回音，把事情接上','管理员已答应，教师 Mochi 收到完成回执'),('end',133,7,'Mochi','连接教学、人和任务。')]
css='''@font-face{font-family:Mochi;src:url(assets/NotoSansCJKsc-Regular.otf)}*{box-sizing:border-box}body{margin:0;background:#f4f3ed;font-family:Mochi,sans-serif;color:#233b32}#film{position:relative;width:1920px;height:1080px;overflow:hidden}.scene{position:absolute;inset:0;visibility:hidden;overflow:hidden}.camera{position:absolute;transform-origin:0 0;width:1920px;height:1080px}.source{display:block;width:1920px;height:1080px}.low .source{width:1600px;height:900px}.pointer{position:absolute;left:0;top:0;width:28px;height:37px;filter:drop-shadow(0 2px 3px #0005);opacity:0;transform-origin:5px 5px}.halo{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;background:radial-gradient(circle,#6f986329 0%,#6f986310 42%,transparent 70%);opacity:0;pointer-events:none}.input-focus{position:absolute;border:2px solid #648760;border-radius:16px;opacity:0;pointer-events:none;box-shadow:0 0 26px #70986824}.ring,.ring2{position:absolute;width:64px;height:64px;border:2px solid #41694f;border-radius:50%;opacity:0;margin:-32px 0 0 -32px}.ring2{border-width:1px}.subtitle{position:absolute;left:46px;bottom:30px;max-width:1818px;padding:16px 25px 18px;border:1px solid #fff9;border-radius:13px;background:#fbfaf5f7;box-shadow:0 8px 32px #18342518;z-index:5}.title{font-size:30px;line-height:1.3;letter-spacing:.2px}.caption{font-size:18px;color:#506456;margin-top:6px;line-height:1.5}.chat .subtitle,.low .subtitle{bottom:auto;top:25px}.chapter{position:absolute;right:35px;top:25px;z-index:6;padding:8px 14px;border-radius:8px;background:#f9f8f0eb;color:#536b59;font-size:14px;letter-spacing:1px}.chat .chapter,.low .chapter{top:auto;bottom:20px}.track{position:absolute;left:0;bottom:0;width:1920px;height:3px;background:#476e54;transform-origin:0 50%;z-index:10}.veil{position:absolute;inset:0;background:#f7f6efeb;opacity:0}.hero .subtitle,.end .subtitle{background:none;border:0;box-shadow:none;left:0;bottom:auto;top:345px;width:1920px;text-align:center;max-width:none}.hero .title{font-size:63px}.hero .caption{font-size:27px;margin-top:24px}.end .title{font-size:112px;letter-spacing:-2px}.end .caption{font-size:32px;margin-top:12px}'''
svg='<div class="halo"></div><div class="input-focus"></div><svg class="pointer" viewBox="0 0 34 44"><path d="M3 2L3 34L11 26L19 41L25 38L17 24L30 23Z" fill="#304d3e" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg><div class="ring"></div><div class="ring2"></div>'
secs=[]
for i,(n,t,d,h,c) in enumerate(S):
 chat=n in ['setup','ask','approve','a2asend','a2areply','a2areturn'];cls=' low' if n in ['typing','generation'] else ' hero' if n=='intro' else ' end' if n=='end' else ' chat' if chat else ''
 media=f'<img id="hero{i}" class="source" src="recordings/live-v2/home-hd-00000.png" data-start="{t}" data-duration="{d}">' if n in ['intro','end'] else f'<video id="v{i}" class="source" src="assets/live/{n}.mp4" muted playsinline preload="auto" data-start="{t}" data-duration="{d}" data-track-index="{i}"></video>'
 chapter='教学准备' if t<49 else '校园事务' if t<88 else 'A2A 协作 · 演示账号'
 secs.append(f'<section id="s{i}" class="scene{cls}"><div class="camera">{media}{svg}</div><div class="veil"></div><div class="chapter">{chapter}</div><div class="subtitle"><div class="title">{h}</div><div class="caption">{c}</div></div></section>')
js='''const tl=gsap.timeline({paused:true,defaults:{ease:'power3.inOut'}});window.__timelines={'mochi-film':tl};
function view(i,s,x,y,t,d=.85){tl.to('#s'+i+' .camera',{scale:s,x,y,duration:d},t)}
function point(i,x,y,t){tl.to('#s'+i+' .halo',{opacity:.8,x,y,duration:.68,ease:'power2.inOut'},Math.max(0,t-.7));tl.to('#s'+i+' .halo',{opacity:0,duration:.7},t+.5);const p='#s'+i+' .pointer';tl.to(p,{opacity:1,x,y,duration:.68,ease:'power2.inOut'},Math.max(0,t-.7));tl.to(p,{scale:.77,duration:.08},t);tl.to(p,{scale:1,duration:.22,ease:'back.out(2)'},t+.08);for(let j=0;j<2;j++){let r='#s'+i+(j?' .ring2':' .ring');tl.set(r,{left:x,top:y,opacity:.6-j*.2,scale:.2},t+j*.08);tl.to(r,{scale:1.1+j*.3,opacity:0,duration:.6},t+j*.08);}}
'''
clicks=[]
for i,(n,t,d,h,c) in enumerate(S):
 low=n in ['typing','generation'];chat=n in ['ask','approve','a2asend','a2areply','a2areturn'];scale=1 if low else 1.65 if chat else .97;bx=160 if low else -846 if chat else 29;by=45 if low else -790 if chat else 0
 js+=f"tl.set('#s{i}',{{visibility:'visible',opacity:1}},{t});tl.set('#s{i} .camera',{{scale:{scale},x:{bx},y:{by}}},{t});tl.set('#s{i} .pointer',{{x:1100,y:920}},{t});tl.fromTo('#s{i} .subtitle',{{opacity:0,y:18}},{{opacity:1,y:0,duration:.5}},{t+.1});tl.to('#s{i}',{{opacity:0,duration:.3}},{t+d-.3});\n"
 if n in ['intro','end']:
  js+=f"tl.set('#s{i} .veil',{{opacity:1}},{t});tl.set('#s{i} .chapter',{{opacity:0}},{t});view({i},1.02,-19,-10,{t},{d});\n";continue
 for e in M[n]['events']:
  et=t+e['t'];x=e['x'];y=e['y'];js+=f'point({i},{x},{y},{et});\n';clicks.append({'t':et,'source':n,'name':e.get('name','click')})
  if n=='model':s=1.32;cx=-580;cy=-105
  elif n=='quiz':s=1.25;cx=-480;cy=max(-200,min(-35,590-y*s))
  elif n=='campus':s=1.10;cx=-150;cy=-30
  elif n=='setup':s=1.3;cx=-180;cy=max(-345,min(0,400-y*s))
  elif n=='home':s=1.25;cx=-175;cy=-130
  elif chat:s=1.65;cx=-846;cy=-790
  else:continue
  js+=f'view({i},{s},{cx},{cy},{max(t,et-.8)});\n'
 if n=='model':js+=f'view({i},1.3,-565,-110,{t});view({i},1.05,-95,-20,{t+d-1.5});\n'
 if n=='quiz':js+=f'view({i},1.24,-460,-35,{t});\n'
 if chat:
  js+=f"tl.set('#s{i} .camera',{{scale:1.55,x:-737,y:-680}},{t});tl.set('#s{i} .input-focus',{{left:620,top:954,width:950,height:99}},{t});tl.to('#s{i} .input-focus',{{opacity:.65,duration:.7}},{t+.3});tl.to('#s{i} .input-focus',{{opacity:0,duration:.5}},{t+M[n]['events'][0]['t']});\n"
  js+=f"tl.set('#s{i} .camera',{{clipPath:'inset(940px 330px 20px 610px round 12px)'}},{t});tl.to('#s{i} .camera',{{clipPath:'inset(630px 330px 20px 610px round 12px)',duration:1.1}},{t+M[n]['events'][0]['t']+.35});\n"
 if n=='setup':js+=f"tl.set('#s{i} .camera',{{scale:1.3,x:-180,y:180}},{t});\n"
 if n=='typing':js+=f"tl.set('#s{i} .camera',{{clipPath:'inset(160px 0px 0px 270px)'}},{t});\n"
 if n=='generation':js+=f'view({i},1.05,100,-8,{t},1.2);\n'
js+="tl.fromTo('.track',{scaleX:0},{scaleX:1,duration:140,ease:'none'},0);tl.to({v:0},{v:1,duration:140,ease:'none'},0);"
(B/'index.html').write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi · 140 秒真实工作故事</title><script src="assets/gsap.min.js"></script><style>'+css+'</style></head><body><main id="film" data-composition-id="mochi-film" data-width="1920" data-height="1080" data-duration="140" data-fps="60">'+''.join(secs)+'<div class="track"></div><audio id="music" src="assets/rhythmic-score.wav" data-start="0" data-duration="140" data-track-index="20"></audio></main><script>'+js+'</script></body></html>')
(B/'timeline-v2.json').write_text(json.dumps([{'source':n,'start':t,'duration':d,'title':h,'caption':c} for n,t,d,h,c in S],ensure_ascii=False,indent=2));(B/'assets/live/clicks.json').write_text(json.dumps(clicks,ensure_ascii=False,indent=2))
def stamp(t):return f'{int(t)//3600:02}:{int(t)%3600//60:02}:{int(t)%60:02},000'
(B/'output/Mochi_140秒_真实工作故事.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(t)} --> {stamp(t+d)}\n{h}\n{c}' for i,(n,t,d,h,c) in enumerate(S)))
print('140 seconds,',len(clicks),'actual clicks')
