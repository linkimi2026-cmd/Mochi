from pathlib import Path
import json, subprocess, concurrent.futures
B=Path(__file__).resolve().parent
O=B/'v3'; A=O/'assets'; A.mkdir(parents=True,exist_ok=True)
M=json.loads((B/'assets/live/edit-map.json').read_text())
# Each existing recording is retimed in full, so approvals and results are retained.
D={'home':2.5,'setup':2.5,'typing':3,'generation':3,'model':6,'quiz':4,'campus':5,'ask':9,'approve':11,'a2asend':5,'a2areply':5,'a2areturn':4}
def transcode(it):
 n,d=it;src=B/f'assets/live/{n}.mp4';out=A/f'{n}.mp4'
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(src)]))
 if not out.exists(): subprocess.run(['ffmpeg','-v','error','-y','-i',str(src),'-vf',f'setpts={d/duration}*(PTS-STARTPTS),fps=30','-t',str(d),'-an','-c:v','libx264','-preset','fast','-crf','17',str(out)],check=True)
 return n,{'sourceDuration':duration,'duration':d,'events':[dict(e,t=e['t']*d/duration) for e in M[n]['events']]}
meta=dict(concurrent.futures.ThreadPoolExecutor(max_workers=3).map(transcode,D.items()))
(A/'retiming.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
meta.update({'classroom-open':{'events':[{'t':1.98,'x':1790,'y':48}]},'agent-presets':{'events':[]},'find-teacher-clean':{'events':[]},'classroom-refined-received':{'events':[]},'find-peer-clean':{'events':[]}})
# All UI media is recorded from the actual product.
S=[('image','slide-1.png',0,3,'从备课，到校园协作','Mochi · 校园工作的 AI 伙伴','hero'),('image','slide-2.png',3,2,'把数据，变成看得懂的发现','真实生成的可编辑课件','output'),('video','model.mp4',5,3,'让知识，可以动手','交互模型 · 真实操作','wide'),('video','home.mp4',8,2.5,'从工作区开始','文件与任务放在一起','wide'),('video','setup.mp4',10.5,2.5,'切换工作模式','教学生成 · 选择权限','wide'),('video','typing.mp4',13,3,'把需求交给 Mochi','输入 → 发送','input'),('video','generation.mp4',16,3,'看见执行过程','真实生成过程加速节选','input'),('image','slide-1.png',19,3,'课件，也能直接交付','另一项真实任务 · 节水调查课件','output'),('image','slide-2.png',22,3,'数据变成课堂重点','场景、数值与图表逐项对应','output'),('image','slide-3.png',25,2,'让推理过程清楚可见','图形化换算 · 虚拟教学数据','output'),('image','exam-1.png',27,3,'把课堂问题，整理成一份试卷','学生卷与答案分开 · 可编辑 Word + PDF','exam'),('video','model.mp4',30,5,'抽象概念，亲手验证','点击切换并观察变化','wide'),('video','campus.mp4',35,5,'课堂之外，校园工作也在这里','待办与事件，连接教师的下一步','wide'),('video','ask.mp4',40,9,'“她在不在校，在哪里？”','Mochi 查询登记状态与到达记录','chat'),('video','approve.mp4',49,11,'核对申请，再批准放行','真实演示账号 · 保留人工确认','chat'),('video','find-peer-clean.mp4',60,6,'Agent to Agent · 协作找资料','管理员的 Mochi 查找数据、讲解稿与课件','relay'),('video','find-teacher-clean.mp4',66,8,'回音，回到教师手中','真实查询 → 完成回执 · 资料查找闭环','relay'),('video','classroom-refined-received.mp4',74,4,'课件，送到教室','真实局域网接收 · 教师端 → 教室端','received'),('video','classroom-open.mp4',78,4,'收到，然后开始使用','收到的课件 · 实际打开与翻页','opened'),('video','agent-presets.mp4',82,5,'让能力，适应你的工作','工作预设 · 插件 · 自定义 Agent','presets'),('image','slide-1.png',87,3,'Mochi','连接教师、同事与课堂','end')]
css='''@font-face{font-family:Mochi;src:url(assets/NotoSansCJKsc-Regular.otf)}*{box-sizing:border-box}body{margin:0;font-family:Mochi,sans-serif;background:#071321;color:#f3f7fa}#film{position:relative;width:1920px;height:1080px;overflow:hidden}.scene{position:absolute;inset:0;visibility:hidden}.glow{position:absolute;width:1000px;height:1000px;left:1100px;top:-500px;background:radial-gradient(circle,#28cdbb28,transparent 65%)}.eyebrow{position:absolute;left:76px;top:36px;font-size:17px;letter-spacing:3px;color:#63dccc}.frame{position:absolute;left:76px;top:96px;width:1768px;height:830px;overflow:hidden;border-radius:22px;background:#f7f6ef;box-shadow:0 25px 75px #0008;border:1px solid #ffffff24}.camera{position:absolute;width:1920px;height:1080px;transform-origin:0 0}.media{width:1920px;height:1080px;display:block}.output .frame,.exam .frame{left:220px;top:68px;width:1480px;height:832px}.output .camera,.exam .camera{width:1600px;height:900px}.output .media{width:1600px;height:900px}.copy{position:absolute;left:76px;right:76px;bottom:30px;display:flex;align-items:end;justify-content:space-between;gap:55px}.title{font-size:38px;line-height:1.3}.caption{font-size:20px;line-height:1.5;color:#a9bbc9;max-width:680px;text-align:right}.pointer{position:absolute;width:30px;height:40px;opacity:0;filter:drop-shadow(0 2px 4px #0008)}.ring{position:absolute;width:72px;height:72px;margin:-36px;border:3px solid #17c8b4;border-radius:50%;opacity:0}.hero .frame,.end .frame{left:0;top:0;width:1920px;height:1080px;border:0;border-radius:0;opacity:.2}.hero .copy,.end .copy{display:block;top:330px;bottom:auto;text-align:center}.hero .title{font-size:76px}.end .title{font-size:140px}.hero .caption,.end .caption{font-size:30px;max-width:none;text-align:center;margin-top:30px;color:#7de8d9}.bar{position:absolute;bottom:0;height:3px;width:1920px;background:#20ccba;transform-origin:left;z-index:50}'''
css+=' .input .media{width:1600px;height:900px}.exam .frame{background:#10253b}.opened .frame{background:#1d2027}.exam .camera{width:1600px;height:900px}'
html=[];js=["const tl=gsap.timeline({paused:true,defaults:{ease:'power3.inOut'}});window.__timelines={'mochi90':tl};"]
for i,(kind,name,t,d,title,caption,style) in enumerate(S):
 media=(f'<video id="media{i}" class="media" src="assets/{name}" muted playsinline data-start="{t}" data-duration="{d}" data-track-index="{i}"></video>' if kind=='video' else f'<img id="media{i}" class="media" src="assets/{name}" data-start="{t}" data-duration="{d}">')
 if style=='exam': media=f'<img id="exam-front" src="assets/exam-1.png" style="position:absolute;left:100px;top:0;width:635px;height:900px;object-fit:contain"><img id="exam-answer" src="assets/exam-2.png" style="position:absolute;left:845px;top:0;width:635px;height:900px;object-fit:contain">'
 html.append(f'<section id="s{i}" class="scene {style}"><div class="glow"></div><div class="eyebrow">MOCHI / '+('教学准备' if t<35 else '校园事务' if t<60 else '连接与协作')+f'</div><div class="frame"><div class="camera" data-layout-allow-overflow>{media}<svg class="pointer" viewBox="0 0 34 44"><path d="M3 2L3 34L11 26L19 41L25 38L17 24L30 23Z" fill="#163d39" stroke="white" stroke-width="2.5"/></svg><div class="ring"></div></div></div><div class="copy"><div class="title">{title}</div><div class="caption">{caption}</div></div></section>')
 q=f'#s{i}';scale=.925 if style in ['output','exam'] else .92 if style=='wide' else 1.65 if style=='input' else 1.5 if style=='chat' else 1
 x=-700 if style=='input' else -680 if style=='chat' else 0;y=-650 if style=='input' else -710 if style=='chat' else -50 if style=='wide' else 0
 if name=='model.mp4': scale=1.6;x=-1680;y=-440
 if style=='relay': scale=1.2;x=-580;y=-250
 if style=='received': scale=1.23;x=-225;y=-70
 if style=='presets': scale=1.18;x=-240;y=-70
 if style=='opened': scale=.77;x=145;y=0
 js+= [f"tl.set('{q}',{{visibility:'visible',opacity:1}},{t});tl.set('{q} .camera',{{scale:{scale},x:{x},y:{y}}},{t});",f"tl.fromTo('{q} .frame',{{y:35,opacity:0}},{{y:0,opacity:{'.2' if style in ['hero','end'] else '1'},duration:.55,immediateRender:false}},{t});",f"tl.fromTo('{q} .copy',{{y:18,opacity:0}},{{y:0,opacity:1,duration:.4}},{t+.1});tl.set('{q}',{{opacity:0}},{t+d+.55 if t+d<90 else 90});",f"tl.fromTo('{q} .glow',{{x:-100}},{{x:80,duration:{d},ease:'none'}},{t});"]
 if style in ['output','exam'] and name!='slide-2.png':js.append(f"tl.to('{q} .camera',{{scale:.943,x:-14,y:-8,duration:{d},ease:'none'}},{t});")
 if style=='output':
  # Vary framing around actual delivered pages; never redraw or replace product content.
  if name=='slide-2.png':
   js.append(f"tl.set('{q} .frame',{{left:76,top:68,width:1768,height:832}},{t});tl.set('{q} .camera',{{scale:1.12,x:0,y:-54}},{t});tl.to('{q} .camera',{{scale:1.13,x:-8,y:-65,duration:{d},ease:'power2.inOut'}},{t});")
  elif name=='slide-3.png':
   js.append(f"tl.fromTo('{q} .frame',{{x:80}},{{x:0,duration:.65,immediateRender:false}},{t});")
 if style=='exam':
  js.append(f"tl.fromTo('{q} #exam-front',{{x:-100,opacity:0}},{{x:0,opacity:1,duration:.6}},{t});tl.fromTo('{q} #exam-answer',{{x:100,opacity:0}},{{x:0,opacity:1,duration:.6}},{t+.2});")
 if kind=='video':
  for e in meta[name[:-4]]['events']:
   et=t+e['t'];ex=e['x'];ey=e['y']
   js.append(f"tl.to('{q} .camera',{{x:{x-12*(ex/1920-.5):.3f},y:{y-8*(ey/1080-.5):.3f},duration:.65,ease:'power2.inOut',overwrite:'auto'}},{max(t,et-.65)});")
   if et>=t+d:continue
   js += [f"tl.to('{q} .pointer',{{opacity:1,x:{ex},y:{ey},duration:.45,overwrite:'auto'}},{max(t,et-.45)});tl.set('{q} .ring',{{left:{ex},top:{ey},scale:.15,opacity:.8}},{et});tl.to('{q} .ring',{{scale:1.2,opacity:0,duration:.5}},{et});"]
js.append("tl.fromTo('.bar',{scaleX:0},{scaleX:1,duration:90,ease:'none'},0);tl.to({v:0},{v:1,duration:90},0);")
(O/'index.html').write_text('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi 90秒 · 剪辑工作版</title><script src="assets/gsap.min.js"></script><style>'+css+'</style></head><body><main id="film" data-composition-id="mochi90" data-width="1920" data-height="1080" data-duration="90" data-fps="60">'+''.join(html)+'<div class="bar"></div><audio id="music" data-timeline-role="music" src="assets/music.wav" data-start="0" data-duration="90" data-track-index="40"></audio></main><script>'+''.join(js)+'</script></body></html>')
(O/'timeline.json').write_text(json.dumps([dict(kind=k,asset=n,start=t,duration=d,title=h,caption=c,style=s) for k,n,t,d,h,c,s in S],ensure_ascii=False,indent=2))
(O/'STATUS.md').write_text('可编辑工程；已验证输出与范围见 ../evidence/v3-final-qa/验收记录.md。重新编辑后需重新导出和检查。\n')
print('Built 90-second draft timeline:',len(S),'shots')
