from pathlib import Path
import re,json,shutil
B=Path(__file__).resolve().parent; R=B.parent; O=B/'v4'; A=O/'assets'
# Source-derived view-only composer. Product state and network code remain untouched.
source=R/'mochi-harness-src.nosync/mochi-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css'
composer_css=source.read_text()
composer_css=re.sub(r'(?m)^(\.[A-Za-z][^\n{]*)(\s*\{)',r'.native \1\2',composer_css)
mo=(A/'mo.html').read_text()
mo_css='\n'.join((R/f'client-plugins/jxl-brand/src/{f}.css').read_text() for f in ['OrbCompanion','ExpressiveOrb'])
mo_css=re.sub(r'\.orb-companion--sleep \.orb-companion__orb \{[^}]+\}', '', mo_css)
triangle=(B/'inputs/triangle-demo.html').read_text()
triangle_body=re.search(r'<main>(.*?)</main>',triangle,re.S).group(1)
triangle_css=re.search(r'<style>(.*?)</style>',triangle,re.S).group(1)
# Keep generated SVG geometry, labels, colors, tab states and original layout.
triangle_css=triangle_css[triangle_css.index('  h1{'):]
triangle_css=re.sub(r'(?m)^  (?=[.#a-z])', '  #model-original ',triangle_css)
js=[(O/'orb-guide.js').read_text(),"const tl=gsap.timeline({paused:true,defaults:{ease:'power3.inOut'}});window.__timelines={mochiV4:tl};"]
sections=[]; manifest=[]; cursor_moves=[]
def scene(id,t,d,body,cls='',title='',sub=''):
 if id=='outputs':
  prefix,suffix=body.split('<div id="hero-slide">')
  prefix=re.sub(r'<img src="([^"]+)">',r'<div class="gallery-thumb" role="img" aria-label="Mochi 实际生成成果" style="background-image:url(\1)"></div>',prefix)
  body=prefix+'<div id="hero-slide">'+suffix
 imgnum=[0]
 def mark(m):
  imgnum[0]+=1
  return f'<img id="{id}-image-{imgnum[0]}" data-start="{t}" data-duration="{d}" '
 body=re.sub(r'<img ',mark,body)
 sections.append(f'<section id="{id}" class="scene {cls}" data-layout-allow-overflow>{body}'+(f'<div class="caption"><b>{title}</b><span>{sub}</span></div>' if title else '')+'</section>')
 js.extend([f"tl.set('#{id}',{{display:'block'}},{t});",f"tl.fromTo('#{id}',{{opacity:0}},{{opacity:1,duration:.45,immediateRender:false}},{t});",f"tl.set('#{id}',{{display:'none'}},{t+d+.45 if t+d<90 else 90});"])
 manifest.append(dict(id=id,start=t,duration=d,title=title,subtitle=sub))
def enter(sel,t,x=0,y=40):
 js.append(f"tl.set('{sel}',{{opacity:0}},0);")
 js.append(f"tl.fromTo('{sel}',{{x:{x},y:{y},opacity:0}},{{x:0,y:0,opacity:1,duration:.8,immediateRender:false}},{t});")
def cursor(x,y,t,click=False):
 cursor_moves.append(dict(x=x,y=y,t=t,click=click))
 if click:
  js.extend([f"tl.set('#click',{{x:{x},y:{y},opacity:.8,scale:.15}},{t+.55});tl.to('#click',{{scale:1.4,opacity:0,duration:.5}},{t+.55});",f"tl.to('#cursor',{{scale:.8,duration:.12}},{t+.52});tl.to('#cursor',{{scale:1,duration:.18}},{t+.67});"])
def thread(t,path,d=1.3):
 pass  # Guidance is generated from the actual authored cursor flights.
def video(id,n,t,d,title,sub,mode='full'):
 if mode=='chat': frame=(90,108,1740,847); crop=(610,680,3040,1480); mw,mh=1740,847; vx,vy=0,0
 elif mode=='relay':frame=(465,205,1360,650);crop=None;mw,mh=1920,1080;vx,vy=-420,-235
 elif mode=='received':frame=(370,176,1430,700);crop=None;mw,mh=1760,990;vx,vy=-170,-30
 else:frame=(200,105,1520,855);crop=None;mw,mh=1520,855;vx,vy=0,0
 left,top,w,h=frame
 body=f'<div class="product-window" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px"><div class="camera" style="width:{mw}px;height:{mh}px;left:{vx}px;top:{vy}px"><video id="{id}-media" src="assets/{n}.mp4" muted playsinline data-start="{t}" data-duration="{d}" data-track-index="{len(manifest)+1}" style="width:100%;height:100%"></video></div></div>'
 if mode=='relay':
  body='<div class="network-header"><div class="network-agent">'+mo.replace('eob-R1-depth',id+'-teacher-depth')+'<span>教师 Mochi</span></div><svg viewBox="0 0 500 60"><path d="M 10 30 H 490"/><circle class="message-dot" cx="10" cy="30" r="6"/></svg><div class="network-agent">'+mo.replace('eob-R1-depth',id+'-admin-depth')+'<span>管理员 Mochi</span></div></div>'+body
  startx,endx=(10,490) if id=='findpeer' else (490,10)
  js.append(f"tl.fromTo('#{id} .message-dot',{{attr:{{cx:{startx}}}}},{{attr:{{cx:{endx}}},duration:1.5,immediateRender:false}},{t+.65});")
 if mode in ['relay','received']: body=f'<div class="side-copy"><small>'+('AGENT TO AGENT' if mode=='relay' else 'READY FOR CLASS')+f'</small><h2>{title}</h2></div>'+body
 scene(id,t,d,body,mode,title if mode not in ['relay','received'] else '',sub)
 enter(f'#{id} .product-window',t,70,0)
 if mode=='relay':
  enter(f'#{id} .network-header',t+.1,20,0)
  js.append(f"tl.to('#{id} .network-header',{{opacity:0,y:-15,duration:.3}},{t+d-.35});")
 meta=json.loads((A/'media-map.json').read_text()).get(n,{}) if (A/'media-map.json').exists() else {}
 for e in meta.get('events',[]):
  if e['t']>=d-.2:continue
  if crop:
   ex=left+(e['x']*2-crop[0])/crop[2]*w;ey=top+(e['y']*2-crop[1])/crop[3]*h
  else: ex=left+e['x']/1920*mw+vx;ey=top+e['y']/1080*mh+vy
  if left<ex<left+w and top<ey<top+h:
   if mode=='full':
    px,py=ex-left,ey-top
    cx=max(w-mw*1.1,min(0,w*.5-px*1.1));cy=max(h-mh*1.1,min(0,h*.5-py*1.1))
    js.append(f"tl.to('#{id} .camera',{{scale:1.1,x:{cx},y:{cy},duration:.65,ease:'power2.inOut'}},{max(t,t+e['t']-.65)});")
    ex=left+px*1.1+cx;ey=top+py*1.1+cy
   cursor(round(ex),round(ey),max(t,t+e['t']-.55),True)
 js.append(f"tl.to('#cursor',{{opacity:0,duration:.2}},{t+d-.3});")
# The opening does not replace or impersonate application controls.
scene('intro',0,3,'<div class="intro-copy"><span class="overline">MOCHI · 校园工作的 AI 伙伴</span><h1><span>一句话。</span><span>让工作开始。</span></h1></div><div class="intro-mark">'+mo.replace('eob-R1-depth','intro-depth')+'</div>')
enter('#intro h1 span:nth-child(1)',.1,0,50);enter('#intro h1 span:nth-child(2)',.35,0,60);enter('#intro .intro-mark',.4,80,0)
thread(1.35,'M 1080 650 C 1330 650 1290 790 1590 790 S 1800 600 1900 600',1.4)
video('home','home',3,3,'先选择工作区','文件、任务与上下文，在一起')
video('setup','setup',6,4,'切换「工作」，开放执行权限','选择完全权限 → 全部允许；工作台及时收起')
# Original InputBar structure and CSS, enlarged as a production close-up.
composer='''<div class="native"><div class="root hero"><div class="card"><div class="scroll"><div class="grow"><div class="input"><span id="typed"></span><i id="caret"></i></div></div></div><div class="row"><div class="tools"><button class="add">＋</button><button class="add"><svg width="15" height="15" viewBox="0 0 24 24"><path d="M8 12v5a4 4 0 0 0 8 0V7a3 3 0 0 0-6 0v9a1 1 0 0 0 2 0V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><div class="modes"><span class="select">完全权限</span></div></div><div class="trailing"><span class="select">DeepSeek Expert Visual</span><button class="primary" id="send"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 20V4M5 11l7-7 7 7" fill="none" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div></div></div></div>'''
scene('compose',10,8,'<div class="compose-label"><small>准备一堂课，从真实材料开始</small><h2>把需求，交给 Mochi。</h2></div><div class="workspace">▱ 测试　⌄　　备课与课件　⌄</div><div id="composer">'+composer+'</div><div id="execution"><div class="mini-mo">'+mo.replace('eob-R1-depth','exec-depth')+'</div><div class="tool-row">工具调用 · file_search · 宣传片V3</div><div class="tool-row">读取 · 校园节水调查.csv</div><div class="tool-row">本次产出　<span class="file-pill">presentation.pptx</span></div></div><div class="small-note">任务过程节选 · 演示材料为虚拟教学数据</div>')
enter('#compose .compose-label',10,0,30);enter('#composer',10.1,0,50)
text='根据校园节水调查数据，制作一份图文课件，并整理课堂练习。'
for i in range(len(text)+1):js.append(f"tl.set('#typed',{{textContent:{json.dumps(text[:i],ensure_ascii=False)}}},{10.6+i*.075});")
js.append("tl.fromTo('#caret',{opacity:0},{opacity:1,duration:.32,repeat:9,yoyo:true,ease:'none'},10.5);")
cursor(1240,775,10.25);cursor(1484,666,13.05,True)
js.extend(["tl.to('#send',{scale:.85,duration:.12},13.6);tl.to('#send',{scale:1,duration:.2},13.72);tl.to('#cursor',{opacity:0,duration:.18},13.7);", "tl.to('#composer',{y:-90,scale:.87,duration:1},13.8);tl.to('#compose .compose-label',{y:-40,opacity:0,duration:.6},13.8);tl.to('#compose .workspace',{opacity:0,duration:.3},13.8);tl.to('#caret',{opacity:0,duration:.2},13.8);"])
thread(13.65,'M 1484 666 C 1670 666 1680 770 1480 770 S 650 780 460 710 Q 430 655 485 635',1.15)
enter('#execution',14.5,0,30)
for i in range(3):enter(f'#execution .tool-row:nth-of-type({i+2})',14.8+i*.65,25,0)
# A true artifact stays the visual anchor as the layout opens into moving columns.
scene('outputs',18,11,'<div class="gallery-heading"><small>从原始数据，到可交付成果</small><h2>不止回答。<br>交付一整套课堂材料。</h2></div><div id="conveyor"><div class="belt left">'+''.join(f'<div class="artifact"><img src="assets/slide-{i}.png"><span>可编辑 PPT · 课堂展示</span></div>' for i in [2,3,4,2])+'</div><div class="belt middle">'+''.join(f'<div class="artifact paper"><img src="assets/exam-{i}.png"><span>'+('学生练习' if i==1 else '答案与解析')+'</span></div>' for i in [1,2,1])+'</div><div class="belt right">'+''.join(f'<div class="artifact"><img src="assets/slide-{i}.png"><span>从观察，到行动</span></div>' for i in [4,1,3,4])+'</div></div><div id="hero-slide"><img src="assets/slide-1.png"></div><div id="artifact-tag">Mochi 实际生成 · 可编辑 PPTX / Word / PDF</div>')
enter('#hero-slide',18,130,50)
js.extend(["tl.to('#hero-slide',{x:765,y:55,scale:.31,duration:1.1},21);tl.to('#hero-slide',{opacity:0,duration:.3},22.1);", "tl.fromTo('#conveyor',{opacity:0,scale:.92},{opacity:1,scale:1,duration:1.1,immediateRender:false},21);tl.fromTo('.gallery-heading',{opacity:0,x:-45},{opacity:1,x:0,duration:.8,immediateRender:false},21.2);", "tl.fromTo('.belt.left',{y:20},{y:-515,duration:8,ease:'none',immediateRender:false},21);tl.fromTo('.belt.middle',{y:-615},{y:-65,duration:8,ease:'none',immediateRender:false},21);tl.fromTo('.belt.right',{y:90},{y:-470,duration:8,ease:'none',immediateRender:false},21);"])
thread(27.5,'M 1770 960 C 1480 960 1530 1030 1050 1030 S 330 940 140 940',1.2)
scene('model',29,6,'<div class="model-copy"><small>INTERACTIVE LEARNING</small><h2>让抽象知识，<br>动起来。</h2><p>点击、切换、观察。<br>把概念变成可操作的交互模型。</p></div><div id="model-card"><div id="model-original">'+triangle_body+'</div></div>')
enter('#model-card',29,180,0);enter('.model-copy',29.15,-50,0)
notes={'right':'有一个角是直角，正好 90°，图上用「方角」标出来。','obtuse':'有一个角是钝角，大于 90°，图上张得最大的那个角就是它。','acute':'三个角都是锐角，都小于 90°。'}
for key,t,x in [('right',30,1297),('obtuse',31.8,1510),('acute',33.5,1080)]:
 cursor(x,782,t,True)
 js.append(f"tl.set('#model-original .figure',{{opacity:0,visibility:'hidden'}},{t+.55});tl.set('#model-original .figure[data-key={key}]',{{visibility:'visible',opacity:1}},{t+.55});tl.set('#model-original button',{{attr:{{'aria-pressed':'false'}}}},{t+.55});tl.set('#model-original button[data-key={key}]',{{attr:{{'aria-pressed':'true'}}}},{t+.55});tl.set('#model-original #note',{{textContent:{json.dumps(notes[key],ensure_ascii=False)}}},{t+.55});")
js.append("tl.to('#cursor',{opacity:0,duration:.3},34.65);")
video('campus','campus',35,4,'校园网页，让事务一眼可见','待办 → 学生 → 事件 · 继续交给 Mochi 办理')
exec((O/'campus_scenes.py.inc').read_text())
video('findpeer','find-peer-clean',58,4,'让同事的<br>Mochi，<br>一起找。','管理员端 · 真实协作找资料','relay')
video('findreturn','find-teacher-clean',62,5,'找到资料。<br>回音回来。','教师端 · 已完成回执','relay')
video('received','classroom-refined-received',67,4,'下一站，<br>教室。','局域网文件接收','received')
scene('classroom',71,5,'<div class="classroom-label"><small>课堂材料已就位</small><h2>收到，就能开始使用。</h2></div><div id="class-slide1"><img src="assets/slide-1.png"></div><div id="class-slide2"><img src="assets/slide-2.png"></div><div class="class-controls">‹　<span id="page-count">1 / 4</span>　›</div><div class="small-note">实际收到的课件内容 · 预览与翻页</div>')
enter('#class-slide1',71,60,50);cursor(1130,928,72,True)
js.extend(["tl.fromTo('#class-slide2',{x:110,opacity:0},{x:0,opacity:1,duration:.6,immediateRender:false},72.55);tl.to('#class-slide1',{x:-90,opacity:0,duration:.6},72.55);tl.set('#page-count',{textContent:'2 / 4'},72.55);tl.to('#cursor',{opacity:0,duration:.2},73.2);"])
video('presets','agent-presets',76,3,'为不同工作，选择不同能力','工作预设 · 插件 · 自定义 Agent')
scene('connected',79,6,'<div class="connected-copy"><small>ONE CONTINUOUS WORKFLOW</small><h2>从一个想法，<br>到整个校园的协作。</h2></div><div class="end-art a"><img src="assets/slide-2.png"></div><div class="end-art b"><img src="assets/exam-1.png"></div><div class="end-art c"><img src="assets/slide-4.png"></div><div class="end-words"><span>生成</span><span>执行</span><span>协作</span><span>交付</span></div>')
for i,c in enumerate(['a','b','c']):enter(f'.end-art.{c}',79+i*.17,80,70)
thread(80,'M 100 1038 C 450 1038 520 1030 780 1030 S 1260 1045 1710 1030',2)
js.append("tl.to('.end-art.a',{y:-65,duration:4.6,ease:'none'},80.2);tl.to('.end-art.b',{y:50,duration:4.6,ease:'none'},80.2);tl.to('.end-art.c',{y:-50,duration:4.6,ease:'none'},80.2);")
scene('end',85,5,'<div id="mo-final">'+mo.replace('eob-R1-depth','final-depth')+'</div><div class="end-title"><span class="wordmark">Mochi</span><span class="arrival">已至</span><i class="end-dot"></i></div><div class="end-sub">连接老师，连接课堂，连接整个校园。</div>')
enter('#mo-final',85,0,80);enter('.end-title',85.45,0,35);enter('.end-sub',85.75,0,25)
thread(85,'M 0 700 C 330 700 440 900 730 900 S 920 800 960 650',1.2)
js.extend(["tl.to('#mo-final .orb-companion__orb',{y:-7,scaleY:1.025,duration:1.4,repeat:2,yoyo:true,ease:'sine.inOut'},85.8);tl.to('#mo-final .expressive-orb__eye',{scaleY:.1,transformOrigin:'50% 50%',duration:.1,repeat:1,yoyo:true},87.5);", "tl.to({v:0},{v:1,duration:90},0);"])
css='''@font-face{font-family:Mochi;src:url(assets/NotoSansCJKsc-Regular.otf)}*{box-sizing:border-box}html,body{margin:0;background:#faf8f2;font-family:Mochi,sans-serif;color:#283d35}#film{width:2560px;height:1440px;position:relative;overflow:hidden}#stage{position:absolute;width:1920px;height:1080px;transform:scale(1.3333333333);transform-origin:0 0;overflow:hidden;background:#faf8f2}.scene{position:absolute;inset:0;display:none;background:#faf8f2}.brand{position:absolute;z-index:100;left:70px;top:35px;font-size:23px;letter-spacing:3px;color:#385a49}.edition{position:absolute;right:70px;top:39px;font-size:14px;color:#76857a;z-index:100}h1,h2,p{margin:0}h2{font-size:56px;line-height:1.4;letter-spacing:-2px;font-weight:600}small,.overline{font-size:18px;letter-spacing:2px;color:#6c8a77}img{display:block;width:100%}.intro-copy{position:absolute;left:210px;top:245px}.intro-copy h1{font-size:105px;line-height:1.32;letter-spacing:-5px;margin-top:35px}.intro-copy h1>span{display:block}.intro-mark{position:absolute;left:1360px;top:350px}.product-window{position:absolute;overflow:hidden;border:1px solid #dcded5;border-radius:23px;background:#f5f3e9;box-shadow:0 18px 48px #314c3512}.camera{position:absolute;transform-origin:0 0}.caption{position:absolute;bottom:40px;left:90px;right:90px;display:flex;align-items:baseline;justify-content:space-between;gap:40px}.caption b{font-weight:500;font-size:32px}.caption span{font-size:18px;color:#6b7d70}.side-copy{position:absolute;left:90px;top:285px;width:320px}.side-copy h2{font-size:49px;margin-top:30px}.relay{background:#eef4e9}.received{background:#f4efe7}.compose-label{position:absolute;left:380px;top:215px}.compose-label h2{margin-top:22px}.workspace{position:absolute;left:405px;top:455px;font-size:23px;color:#4c6255}#composer{position:absolute;left:390px;top:520px;width:1140px;transform-origin:50% 50%}.native{font-family:Mochi;--dsh-composer-card-max-width:760px;--dsh-composer-side-clearance:0;--dsh-content-font-size:18px;--dsw-specific-input-major:#fff;--dsw-elevation-soft:0 0 0 1px #e4e4db,0 8px 20px #43503e0c;--dsw-alias-label-primary:#45584e;--dsw-alias-label-secondary:#5d6b63;--dsw-specific-selector:#f4f3eb;--dsw-alias-button-info-fill:#496554;--dsw-alias-border-l2:#dedfd6;width:760px;transform:scale(1.5);transform-origin:0 0}.native .input{min-height:62px}.native .select{font-family:Mochi;padding-right:17px;font-size:13px}#caret{display:inline-block;width:1.3px;height:22px;background:#4d6856;vertical-align:middle}#execution{position:absolute;left:465px;top:610px;width:1030px;opacity:0;font-size:23px;color:#6b786e}.tool-row{padding:15px 0;border-bottom:1px solid #e5e8dd}.file-pill{display:inline-block;background:#fff;border:1px solid #dde2d5;border-radius:8px;padding:4px 14px;font-size:19px}.mini-mo{height:60px;width:55px}.mini-mo .orb-companion{transform:scale(.16);transform-origin:0 0}.small-note{position:absolute;bottom:40px;left:0;width:100%;text-align:center;font-size:16px;color:#839080}#hero-slide{position:absolute;left:290px;top:130px;width:1340px;border-radius:18px;overflow:hidden;box-shadow:0 25px 80px #30463626;transform-origin:50% 50%}#artifact-tag{position:absolute;bottom:52px;left:75px;font-size:20px;color:#607467}#outputs{background:#eff3e8}.gallery-heading{position:absolute;left:85px;top:355px;width:480px;opacity:0}.gallery-heading h2{font-size:49px;margin-top:25px}#conveyor{position:absolute;left:625px;top:85px;width:1230px;height:890px;overflow:hidden;opacity:0;mask-image:linear-gradient(transparent,black 7%,black 93%,transparent)}.belt{position:absolute;top:0;width:382px;display:flex;flex-direction:column;gap:24px}.belt.left{left:0}.belt.middle{left:414px}.belt.right{left:828px}.artifact{flex:none;border-radius:16px;overflow:hidden;background:white;border:1px solid #dfe5d6;box-shadow:0 10px 20px #2e493711}.artifact span{display:block;padding:17px 19px;font-size:17px;color:#51694f}.artifact.paper{padding:15px}.artifact.paper img{height:440px;object-fit:cover;object-position:top}.artifact.paper span{padding:12px 5px}.model-copy{position:absolute;left:120px;top:310px}.model-copy h2{margin-top:22px}.model-copy p{margin-top:30px;font-size:23px;line-height:1.8;color:#778177}#model{background:#eeeffb}#model-card{position:absolute;left:860px;top:135px;width:875px;height:820px;border-radius:25px;background:#fbfbf9;box-shadow:0 20px 60px #3f4c7418;overflow:hidden}#model-original{position:absolute;width:440px;left:118px;top:40px;transform:scale(1.45);transform-origin:0 0;--ink:#2c2c2c;--ink-2:#6b6b6b;--accent:#3F5B99;--fill:#e9eef7;--line:#dcdcd8;--bg:#fbfbf9;font-size:14px;font-family:Mochi}#classroom{background:#f1f3e8}.classroom-label{position:absolute;left:100px;top:115px}.classroom-label h2{font-size:42px;margin-top:12px}#class-slide1,#class-slide2{position:absolute;left:430px;top:275px;width:1060px;border-radius:15px;overflow:hidden;box-shadow:0 20px 50px #244f3a1a}#class-slide2{opacity:0}.class-controls{position:absolute;left:840px;top:915px;font-size:28px;width:260px;text-align:center}.connected-copy{position:absolute;left:100px;top:220px;width:760px}.connected-copy h2{font-size:62px;margin-top:25px}.end-art{position:absolute;border:1px solid #d7dfce;border-radius:17px;overflow:hidden;box-shadow:0 20px 50px #41633815}.end-art.a{left:1000px;top:200px;width:710px}.end-art.b{left:830px;top:485px;width:310px;transform:rotate(-5deg)}.end-art.c{left:1210px;top:665px;width:540px;transform:rotate(4deg)}.end-words{position:absolute;left:130px;right:140px;top:990px;display:flex;justify-content:space-between;font-size:28px;color:#4c6951}#end{background:#f9f3e7}#mo-final{position:absolute;left:830px;top:220px}.end-title{position:absolute;top:598px;width:100%;text-align:center;font-size:106px;letter-spacing:-4px}.end-sub{position:absolute;top:770px;width:100%;text-align:center;font-size:30px;color:#738270}#thread-layer{position:absolute;inset:0;z-index:110;pointer-events:none}#thread{fill:none;stroke:#79a882;stroke-width:4;stroke-linecap:round;opacity:0}#cursor{position:absolute;width:31px;height:41px;z-index:120;opacity:0;filter:drop-shadow(0 2px 2px #213b422b);transform-origin:3px 3px}#click{position:absolute;width:60px;height:60px;margin:-30px;border:2px solid #688f6f;border-radius:50%;z-index:119;opacity:0}.orb-companion *{animation:none!important}.expressive-orb__body{fill:#a06a32}'''
js.append("tl.fromTo('.arrival',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:.9,immediateRender:false},85.75);tl.fromTo('.end-dot',{scale:0},{scale:1,duration:.6,ease:'back.out(1.5)',immediateRender:false},86.2);")
css+=(O/'refinements.css').read_text()
approval_css=(R/'mochi-harness-src.nosync/mochi-harness/packages/client/ui-approval/src/client/ApprovalPanel.module.css').read_text()
approval_css=re.sub(r'(?m)^(\.[A-Za-z][^\n{]*)(\s*\{)',r'.approval-native \1\2',approval_css)
css+=approval_css
exec((O/'kinetic.py.inc').read_text())
exec((O/'teacher-extension.py.inc').read_text())
html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi · 2K 发布会版</title><script src="assets/gsap.min.js"></script><style>'+composer_css+mo_css+triangle_css+css+'</style></head><body><main id="film" data-composition-id="mochiV4" data-width="2560" data-height="1440" data-duration="102" data-fps="60"><div id="stage"><div class="brand">Mochi</div><div class="edition">连接整个校园。</div>'+''.join(sections)+'<svg id="thread-layer" width="1920" height="1080"><defs><filter id="orb-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="6"/></filter></defs><path id="thread" pathLength="1"/><g id="guide-orb" opacity="0"><circle r="15" fill="#8db87d" opacity=".5" filter="url(#orb-glow)"/><circle r="6" fill="#739d62"/><circle r="2" fill="#f3ffde"/></g></svg><svg id="cursor" viewBox="0 0 34 44"><path d="M3 2L3 34L11 26L19 41L25 38L17 24L30 23Z" fill="#385544" stroke="#fff" stroke-width="2.3"/></svg><div id="click"></div></div><audio id="music" src="assets/music.wav" data-start="0" data-duration="102" data-track-index="40" data-timeline-role="music"></audio></main><script>'+''.join(js)+'</script></body></html>'
(O/'index.html').write_text(html)
(O/'timeline.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(O/'SOURCE-NOTES.md').write_text('''# V4 素材与实现\n\n- 输入与执行特写为 HTML 编排，沿用产品 InputBar 的结构与 CSS，使用已核实任务的内容节选；不连接后端、不把重演当作新一次实测。\n- Mo 为原 OrbCompanion / ExpressiveOrb 的 React SSR 输出；采用原 idle 色值 a06a32，呼吸与眨眼由导出时间轴驱动。\n- 交互三角形直接复用 Mochi 实际生成的 triangle-demo.html 中的 SVG、样式、标签和状态；只把点击切换绑定到导出时间轴。\n- 工作区、模式权限、校园网页、A2A、教室接收与预设取自真实采集序列；4K 原始帧重编，非放大 V3 成片。学生查询、批准、老师 ASK 回应采用原组件样式与真实记录的内容节选重演，保留未确认到达和人工批准的语义。\n- PPT 图片由已核实精修交付 PDF 原生重栅格至 2800 像素，试卷至 2400 像素。\n- 成品画廊与课堂翻页是同一批真实文件的编辑呈现；不宣称浏览器中已有原生 Office 编辑器。\n- A2A 找资料返回文本确认；后续文件到达属于单独的 LAN 发送任务，未画成 FIND 回执附带文件。\n- 审片音轨来自用户提供的 Kimi K2.5 本地视频，未取得可核实的公开传播授权。\n''')
print('Built V4: 102 s / 2560x1440, source-derived HTML and native media')
