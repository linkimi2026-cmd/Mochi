from pathlib import Path
import shutil,json
base=Path(__file__).parent
assets=base/'assets'/'interface';assets.mkdir(exist_ok=True)
for p in (base/'recordings'/'clean').glob('*.png'):shutil.copy2(p,assets/p.name)
for n in ['ui-campus','ui-student-query','ui-a2a-approval','ui-commands']:
 shutil.copy2(base.parent/'参赛PPT'/'history'/'Mochi参赛演示-旧17页版'/'assets'/f'{n}.png',assets/f'{n}.png')
shots=[
 ('home',0,8,'Mochi','你的校园工作伙伴'),
 ('workspace',8,8,'先选工作区','让任务与文件，留在同一个地方'),
 ('permissions-menu',16,8,'明确执行权限','演示会话选择「完全权限」'),
 ('result-full',24,8,'进入工作模式','从需求，到实际文件'),
 ('model-acute-wide',32,11,'把知识变成可操作的模型','在 Mochi 内直接预览、点击、讲解'),
 ('typed',43,9,'继续用一句话修改','保留内容，只调整你想改的地方'),
 ('edit-final',52,5,'修改已完成','执行过程已省略 · 本次修改用时 31 秒'),
 ('updated-acute',57,13,'修改，落实到文件','打开结果，再点一下确认'),
 ('ui-campus',70,12,'今日工作，一处查看','待办、审批与班级概况'),
 ('ui-student-query',82,13,'需要的信息，及时找到','用自然语言查询学生档案 · 演示数据'),
 ('ui-a2a-approval',95,13,'关键操作，由人确认','看清申请内容，再决定下一步'),
 ('ui-commands',108,6,'教学与校园工作','从同一个入口开始'),
 ('home',114,6,'Mochi','把时间，留给教学。')]
(base/'timeline.json').write_text(json.dumps([dict(source=n,start=t,duration=d,title=h,caption=c) for n,t,d,h,c in shots],ensure_ascii=False,indent=2))
styles='''@font-face{font-family:"Mochi Film Sans";src:url("assets/NotoSansCJKsc-Regular.otf") format("opentype");font-weight:100 900;font-display:block}*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f3f2ed;font-family:"Mochi Film Sans",sans-serif;color:#203c33}#film{position:relative;width:1920px;height:1080px;overflow:hidden}.scene{position:absolute;inset:0;visibility:hidden}.label{position:absolute;left:88px;top:48px;font-size:14px;letter-spacing:3px;color:#64786e}.heading{position:absolute;left:88px;top:77px;font-size:48px;font-weight:600;letter-spacing:-1.5px;margin:0}.caption{position:absolute;left:91px;top:144px;font-size:21px;color:#6d7972}.viewport{position:absolute;left:88px;top:210px;width:1744px;height:814px;overflow:hidden;border:1px solid #d6ddd6;border-radius:14px;background:#faf9f5;box-shadow:0 16px 48px #294a3020}.camera{width:1920px;height:1080px;position:absolute;transform-origin:0 0}.source{position:absolute;inset:0;width:1920px;height:1080px;object-fit:fill}.pointer{position:absolute;left:0;top:0;width:27px;height:35px;opacity:0;filter:drop-shadow(0 2px 2px #0004)}.ring{position:absolute;width:56px;height:56px;border:2px solid #426756;border-radius:50%;opacity:0;transform:translate(-50%,-50%)}.foot{position:absolute;right:90px;top:55px;color:#7d8981;font-size:15px}.hero .heading{font-size:68px;line-height:1.05;top:86px}.hero .label{top:30px}.hero .rule{display:none}.hero .caption{top:188px;font-size:25px}.hero .viewport{top:238px;height:786px}.rule{position:absolute;left:90px;top:191px;width:58px;height:3px;background:#567d67}.end .viewport{opacity:.23}.end .heading{top:330px;left:0;width:1920px;text-align:center;font-size:124px;line-height:1.05;z-index:4}.end .caption{top:498px;left:0;width:1920px;text-align:center;font-size:34px;z-index:4}.end .rule{display:none}.end .viewport{top:0;height:1080px;left:0;width:1920px;border:0;border-radius:0}.end .label{z-index:4}.end .foot{z-index:4}'''
svg='<svg class="pointer" viewBox="0 0 34 44"><path d="M3 2 L3 34 L11 26 L19 41 L25 38 L17 24 L30 23 Z" fill="#203b31" stroke="white" stroke-width="2.5" stroke-linejoin="round"/></svg><div class="ring"></div>'
sections=[]
for i,(n,t,d,h,c) in enumerate(shots):
 extra=' hero' if i==0 else ' end' if i==12 else ''
 sections.append(f'<section id="s{i}" class="scene{extra}"><div class="label">MOCHI / PRODUCT FILM</div><div class="foot">真实产品界面 · 过程经剪辑</div><h1 class="heading">{h}</h1><div class="caption">{c}</div><div class="rule"></div><div class="viewport"><div class="camera"><img class="source" src="assets/interface/{n}.png">{svg}</div></div></section>')
script='''const tl=gsap.timeline({paused:true,defaults:{ease:'power3.inOut'}});window.__timelines={'mochi-film':tl};
function view(i,s,x,y,t,d=.85){tl.to('#s'+i+' .camera',{scale:s,x,y,duration:d},t)}
function change(i,name,t){let img=document.createElement('img');img.src='assets/interface/'+name+'.png';img.className='source';img.style.visibility='hidden';let cam=document.querySelector('#s'+i+' .camera');cam.insertBefore(img,cam.querySelector('.pointer'));tl.set('#s'+i+' .source',{visibility:'hidden'},t);tl.set(img,{visibility:'visible'},t)}
function click(i,x,y,t){let p='#s'+i+' .pointer',r='#s'+i+' .ring';tl.set(p,{opacity:1,x:x-135,y:y+45,scale:1},t-.9);tl.to(p,{x,y,duration:.75},t-.9);tl.to(p,{scale:.85,duration:.09},t);tl.to(p,{scale:1,duration:.18},t+.09);tl.set(r,{left:x,top:y,opacity:.6,scale:.35},t);tl.to(r,{scale:1.25,opacity:0,duration:.5},t);tl.to(p,{opacity:0,duration:.25},t+.8)}
'''
for i,(n,t,d,h,c) in enumerate(shots):
 script+=f"tl.set('#s{i}',{{visibility:'visible'}},{t});tl.set('#s{i} .camera',{{scale:.82,x:85,y:-18}},{t});tl.fromTo('#s{i} .heading',{{y:18,opacity:0}},{{y:0,opacity:1,duration:.7}},{t+.1});tl.fromTo('#s{i} .caption',{{y:12,opacity:0}},{{y:0,opacity:1,duration:.65}},{t+.25});tl.fromTo('#s{i} .viewport',{{y:24,opacity:0}},{{y:0,opacity:{'.23' if i==12 else '1'},duration:.8}},{t});tl.to('#s{i}',{{opacity:0,duration:.3}},{t+d-.3});\n"
script+='''
view(0,.86,45,-60,1,1.8);
view(1,1.2,-485,-240,9.1);view(1,.9,8,-64,14.6);
view(2,1.18,-405,-445,17.1);view(2,.84,50,-45,22.3);
view(3,1.2,-340,8,25);view(3,.87,35,-115,28.6);
view(4,1.12,-410,-230,32.8);click(4,1460,762,36.1);change(4,'model-right-wide',36.2);click(4,1610,762,39.7);change(4,'model-obtuse-wide',39.8);
view(5,1.34,-390,-642,43.1);
'''
# True input frames; composited pointer is editorial and anchored to observed DOM coordinates.
for j,p in enumerate(sorted(assets.glob('typing-*.png'))):script+=f"change(5,'{p.stem}',{44+j*.15});\n"
script+="change(5,'typed',48.0);click(5,1547,1023,50.4);\n"
script+='''view(6,.92,-5,-155,52.2);change(6,'edit-final',55.1);
view(7,1.12,-400,-220,58.1);click(7,1460,762,62.1);change(7,'updated-right',62.2);view(7,.84,60,-25,66.7);
view(8,1.1,-355,-75,71.1);view(8,1.2,-425,-230,76.5);
view(9,1.19,-418,-160,83.2);view(9,1.24,-470,-320,89.7);
view(10,1.2,-400,-260,96.1);view(10,1.3,-485,-360,102.1);
view(11,1.18,-425,-190,108.8);
view(12,1.02,-20,-50,114,5.5);tl.to({v:0},{v:1,duration:120,ease:'none'},0);
'''
html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Mochi · 产品介绍</title><script src="assets/gsap.min.js"></script><style>'+styles+'</style></head><body><main id="film" data-composition-id="mochi-film" data-width="1920" data-height="1080" data-duration="120" data-fps="60">'+''.join(sections)+'<audio id="film-score" src="assets/score.wav" data-start="0" data-duration="120" data-track-index="20" data-volume="0.85"></audio></main><script>'+script+'</script></body></html>'
old=base/'index.html'
if not (base/'evidence'/'rejected-environment-draft.html').exists():shutil.copy2(old,base/'evidence'/'rejected-environment-draft.html')
old.write_text(html,encoding='utf-8')
