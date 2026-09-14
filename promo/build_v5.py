from pathlib import Path
import re,json,subprocess
B=Path(__file__).resolve().parent; S=B/'v4'; O=B/'v5'; A=O/'assets'
A.mkdir(parents=True,exist_ok=True)
# Source-time to edit-time mapping. Keep replies readable; shorten repeated holds.
segments=[(0,3,2.5),(3,10,5),(10,18,6),(18,29,4),(29,35,5),(35,39,3),(39,48,6),(48,58,7),(58,70,8),(70,79,6),(79,88,7),(88,91,6),(91,97,0),(97,102,3.5)]
points=[(0,0)]; end=0
for a,b,d in segments:
 end+=d;points.append((b,end))
 if b==29:end+=5;points.append((b,end))
 if b==35:end+=6;points.append((b,end))
assert end==80
def mapped(t):
 for (a,x),(b,y) in zip(points,points[1:]):
  if a==b:continue
  if t<b:return x+(t-a)*(y-x)/(b-a)
 return 80+(t-102)
html=(S/'index.html').read_text().replace('校园网页，让事务一眼可见','我们也为校园协作搭建了配套后端').replace('待办 → 学生 → 事件 · 继续交给 Mochi 办理','待办、学生记录与事务状态，连接起来')
# Source assets are immutable; retimed video and sound files belong only to V5.
for p in (S/'assets').iterdir():
 if p.is_file() and p.suffix not in ['.mp4','.wav']:
  target=A/p.name
  if not target.exists():target.symlink_to(p.resolve())
for tag in re.findall(r'<video\b[^>]+>',html):
 src=re.search(r'src="([^"]+)"',tag).group(1);start=float(re.search(r'data-start="([^"]+)"',tag).group(1));duration=float(re.search(r'data-duration="([^"]+)"',tag).group(1))
 ratio=(mapped(start+duration)-mapped(start))/duration
 target=O/src.replace('.mp4',f'-80-{ratio:.6f}.mp4')
 html=html.replace(f'src="{src}"',f'src="assets/{target.name}"')
 if not target.exists():subprocess.run(['ffmpeg','-v','error','-y','-i',str(S/src),'-an','-vf',f'setpts={ratio}*(PTS-STARTPTS)','-t',str(duration*ratio),'-r','60','-c:v','libx264','-preset','fast','-crf','16',str(target)],check=True)
def timing(m):
 tag=m.group(0)
 a=re.search(r'data-start="([^"]+)"',tag); d=re.search(r'data-duration="([^"]+)"',tag)
 if a and d:
  t=float(a.group(1));dur=float(d.group(1));tag=tag.replace(a.group(0),f'data-start="{mapped(t):.6f}"').replace(d.group(0),f'data-duration="{mapped(t+dur)-mapped(t):.6f}"')
 return tag
html=re.sub(r'<(?:img|video|audio)\b[^>]*>',timing,html)
html=html.replace('data-duration="102"','data-duration="80"').replace('data-fps="60"','data-fps="120"')
# No guidance paths, including the old role-to-role dotted connector. Cursor/click remain.
css='''#thread-layer,.network-header>svg{display:none!important}.approval-native .strip{color:#80612f}
.gallery-heading h2,.model-copy h2,.teacher-heading h2,.connected-copy h2{font-family:MochiDisplay;font-weight:600;letter-spacing:-1px}
.gallery-heading h2{font-size:48px}.teacher-heading h2{font-size:53px}.connected-copy h2{font-size:64px}
#findpeer .side-copy h2,#findreturn .side-copy h2{font-family:MochiDisplay;font-weight:600}
'''
html=html.replace('</style>',css+'</style>')
# A single seekable master drives existing authored motion; media is retimed independently.
script='''const edit=gsap.timeline({paused:true});const playhead={t:0};'''
for (a,x),(b,y) in zip(points,points[1:]):
 script+=f'edit.fromTo(playhead,{{t:{a}}},{{t:{b},duration:{y-x},ease:"none",immediateRender:false,onUpdate:()=>tl.time(playhead.t,false)}},{x});'
exec((O/'model_request.py.inc').read_text())
exec((O/'presets_motion.py.inc').read_text())
exec((O/'quiz_motion.py.inc').read_text())
script+="edit.to('#classroom .small-note',{opacity:0,duration:.2},70.25);"
script+='window.__timelines={mochiV4:edit};'
html=html.replace('</script></body>',script+'</script></body>')
(O/'index.html').write_text(html)
manifest=json.loads((S/'timeline.json').read_text())
for m in manifest:
 a=m['start'];m['start']=round(mapped(a),3);m['duration']=round(mapped(a+m['duration'])-mapped(a),3)
manifest=[m for m in manifest if m['id']!='connected']
for m in manifest:
 if m['id']=='outputs':m['duration']-=5
 if m['id']=='model':m['duration']-=6
manifest.extend([dict(id='model-request',start=mapped(29)-5,duration=5),dict(id='quiz-story',start=mapped(35)-6,duration=6)])
manifest.sort(key=lambda m:m['start'])
(O/'timeline.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(O/'retime.json').write_text(json.dumps(points))
print('V5: 80 seconds / 2560x1440 / 120fps; all guidance paths hidden')
