from pathlib import Path
import numpy as np
from PIL import Image
R=Path(__file__).parent

def projective(points,w=1280,h=720):
 a=[];b=[]
 for (x,y),(u,v) in zip([(0,0),(w,0),(w,h),(0,h)],points):
  a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
 m=np.linalg.solve(a,b); aa,bb,c,d,e,f,g,h=m
 return f'matrix3d({aa}, {d}, 0, {g}, {bb}, {e}, 0, {h}, 0, 0, 1, 0, {c}, {f}, 0, 1)'
s=(R/'index.html').read_text()
s=s.replace('<style>','<style>@font-face{font-family:"PingFang SC";src:local("PingFang SC")}')
# Screen quads measured from the generated plates, no guessed UI geometry.
w,h=Image.open(R/'assets/office-scene.png').size
scale=1920/w
pts=[(858,222),(1491,199),(1490,570),(854,555)]
office=projective([(x*scale,y*scale) for x,y in pts])
w,h=Image.open(R/'assets/classroom-scene.png').size
scale=1920/w
pts=[(553,81),(1468,56),(1468,562),(552,561)]
room=projective([(x*scale,y*scale) for x,y in pts])
# The plates are 1672px wide; the screen artwork is the untouched product source.
scene0='''<div class="office-world"><img class="environment" src="assets/office-scene.png"><div class="office-display"><img src="assets/home.png"></div></div><div class="scene-copy"><span>新的一天，从教学开始。</span><strong>Mochi</strong><p>你的校园工作伙伴</p></div><div class="scene-disclaimer">场景演绎 · 屏幕为真实产品界面</div>'''
start=s.index('<div class="hero-word">');end=s.index('</section>',start)
s=s[:start]+scene0+s[end:]
start=s.index('<div class="screen classroom">');end=s.index('</section>',start)
s=s[:start]+'''<div class="classroom-world"><img class="environment" src="assets/classroom-scene.png"><div class="classroom-display"><iframe id="class-wave" src="assets/wave-film.html" title="课堂模型成果"></iframe></div></div><div class="room-caption">在办公桌前准备。<br>到课堂上展开。</div><div class="scene-disclaimer">场景演绎 · 屏幕为 Mochi 实际生成成果</div>'''+s[end:]
s=s.replace('<section id="s8" class="clip scene dark classroom-scene"','<section id="s8" class="clip scene dark classroom-scene"')
# Remove the former header from the cinematic classroom shot.
a=s.index('<section id="s8"');hs=s.index('<header>',a);he=s.index('</header>',hs)+len('</header>');s=s[:hs]+s[he:]
css=f'''.office-world,.classroom-world{{position:absolute;width:1920px;height:1080px;inset:0;transform-origin:70% 44%}}.environment{{position:absolute;inset:0;width:1920px;height:1080px}}.office-display,.classroom-display{{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0;overflow:hidden;background:#f6f4ed}}.office-display{{transform:{office}}}.classroom-display{{transform:{room}}}.office-display img{{width:1280px;height:720px;display:block}}.classroom-display iframe{{width:1280px;height:720px;border:0}}.scene-copy{{position:absolute;left:100px;top:77px;color:white;text-shadow:0 2px 24px #172b27aa}}.scene-copy span{{font-size:27px;letter-spacing:3px}}.scene-copy strong{{display:block;font-size:88px;font-weight:500;letter-spacing:-5px;margin:14px 0 4px}}.scene-copy p{{font-size:24px;margin:0}}.scene-disclaimer{{position:absolute;right:70px;bottom:34px;color:white;text-shadow:0 2px 9px #000;font-size:17px;letter-spacing:1px;background:#16281fb0;padding:7px 13px;border-radius:5px}}.room-caption{{position:absolute;left:80px;bottom:102px;color:white;text-shadow:0 3px 24px #000;font-size:48px;font-weight:500;line-height:1.5}}'''
s=s.replace('</style>',css+'</style>')
s=s.replace("tl.fromTo('.hero-screen',{x:260,y:80,rotation:4,scale:.92},{x:0,y:0,rotation:0,scale:1,duration:1.8},0);", "tl.fromTo('.office-world',{scale:1.035,x:-12},{scale:1,x:0,duration:5.5,ease:'sine.inOut'},0);\ntl.to('.office-world',{scale:1.5,x:-155,y:50,duration:1.15,ease:'power2.inOut'},5.5);")
s=s.replace("tl.fromTo('.hero-word',{y:40,opacity:0},{y:0,opacity:1,duration:1},.35);", "tl.fromTo('.scene-copy',{y:25,opacity:0},{y:0,opacity:1,duration:1},.6);tl.to('.scene-copy',{opacity:0,duration:.4},5.3);")
s=s.replace("tl.fromTo('.classroom',{x:140,scale:.94},{x:0,scale:1,duration:1.1},87.2);","tl.fromTo('.classroom-world',{scale:1.04},{scale:1,duration:8,ease:'sine.inOut'},87);tl.fromTo('.room-caption',{y:20,opacity:0},{y:0,opacity:1,duration:1},89);")
s=s.replace("catch(e){}", "document.getElementById('class-wave').contentWindow.renderFilmFrame?.(Math.max(0,tl.time()-87));}catch(e){}") if False else s
s=s.replace("wave.contentWindow.renderFilmFrame?.(Math.max(0,tl.time()-50));", "wave.contentWindow.renderFilmFrame?.(Math.max(0,tl.time()-50));document.getElementById('class-wave').contentWindow.renderFilmFrame?.(Math.max(0,tl.time()-87));")
(R/'index.html').write_text(s)
