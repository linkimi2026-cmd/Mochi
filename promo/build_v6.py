from pathlib import Path
import re,json,subprocess
B=Path(__file__).resolve().parent;S=B/'v5';O=B/'v6';A=O/'assets';A.mkdir(parents=True,exist_ok=True)
segments=[(0,13.5,13.5),(13.5,17.5,8),(17.5,22.5,6.5),(22.5,27.5,6.5),(27.5,33.5,8.5),(33.5,36.5,4),(36.5,42.5,7.5),(42.5,49.5,8),(49.5,57.5,9),(57.5,63.5,7),(63.5,70.5,8),(70.5,76.5,7),(76.5,78.5,2),(78.5,82,4.5)]
points=[(0,0)];total=0
for a,b,d in segments:total+=d;points.append((b,total))
assert total==100
def mapped(t):
 for (a,x),(b,y) in zip(points,points[1:]):
  if t<=b:return x+(t-a)/(b-a)*(y-x)
 return 100+(t-82)*4.5/3.5
html=(S/'index.html').read_text()
for p in (S/'assets').iterdir():
 if p.is_file() and p.suffix not in ['.wav','.mp4']:
  target=A/p.name
  if not target.exists():target.symlink_to(p.resolve())
base_tags={re.search(r'id="([^"]+)"',tag).group(1):tag for tag in re.findall(r'<video\b[^>]*>',(B/'v4/index.html').read_text())}
for tag in re.findall(r'<video\b[^>]*>',html):
 ident=re.search(r'id="([^"]+)"',tag).group(1);base=base_tags[ident]
 src=re.search(r'src="([^"]+)"',base).group(1)
 t=float(re.search(r'data-start="([^"]+)"',tag).group(1));d=float(re.search(r'data-duration="([^"]+)"',tag).group(1));base_d=float(re.search(r'data-duration="([^"]+)"',base).group(1))
 duration=mapped(t+d)-mapped(t);ratio=duration/base_d;target=A/Path(src).name
 if not target.exists():subprocess.run(['ffmpeg','-v','error','-y','-i',str(B/'v4'/src),'-an','-vf',f'setpts={ratio}*(PTS-STARTPTS)','-t',str(duration),'-r','60','-c:v','libx264','-preset','fast','-crf','16',str(target)],check=True)
 html=html.replace(tag,re.sub(r'src="[^"]+"',f'src="assets/{target.name}"',tag))
def timing(m):
 tag=m.group(0);a=re.search(r'data-start="([^"]+)"',tag);d=re.search(r'data-duration="([^"]+)"',tag)
 if a and d:
  t=float(a.group(1));duration=float(d.group(1))
  if t>=76.5:t+=2
  end=t+duration
  if 'id="connected-image-' in tag:new_t,new_d=mapped(76.5),2
  elif m.group(0).startswith('<audio'):new_t,new_d=0,100
  else:new_t,new_d=mapped(t),mapped(end)-mapped(t)
  tag=tag.replace(a.group(0),f'data-start="{new_t:.6f}"').replace(d.group(0),f'data-duration="{new_d:.6f}"')
 return tag
html=re.sub(r'<(?:img|audio|video)\b[^>]*>',timing,html).replace('data-duration="80"','data-duration="100"')
# Restore the intentionally removed source scene before the final Mo reveal.
script='''const existing=[...edit.getChildren(false,true,true)];for(const tween of existing){const start=tween.startTime();if(start>=76.5-1e-7){if(tween.vars.t===97 && tween.duration()===0){tween.duration(2);}else{tween.startTime(start+2);}}}const extended=gsap.timeline({paused:true});const clockV6={t:0};'''
for (a,x),(b,y) in zip(points,points[1:]):script+=f'extended.fromTo(clockV6,{{t:{a}}},{{t:{b},duration:{y-x},ease:"none",immediateRender:false,onUpdate:()=>edit.time(clockV6.t,false)}},{x});'
script+='window.__timelines={mochiV4:extended};'
html=html.replace('</script></body>',script+'</script></body>');(O/'index.html').write_text(html)
manifest=json.loads((S/'timeline.json').read_text())
for m in manifest:
 t=m['start']+(2 if m['start']>=76.5 else 0);m['start']=round(mapped(t),3);m['duration']=round(mapped(t+m['duration'])-mapped(t),3)
manifest.append(dict(id='connected',start=mapped(76.5),duration=2,title='成果汇聚（恢复）'));manifest.sort(key=lambda m:m['start'])
(O/'timeline.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(O/'retime.json').write_text(json.dumps(points))
cues=json.loads((S/'audio-cues.json').read_text())
for key in ['accents','clicks']:
 cues[key]=[(mapped(t+(2 if t>=76.5 else 0)),name) for t,name in cues[key]]
cues['duration']=100;cues['source']='Mixkit Tech House vibes, original contiguous 0–100s';(O/'audio-cues.json').write_text(json.dumps(cues,ensure_ascii=False,indent=2))
print('Built V6: 100 seconds, restored convergence, extended short scenes')
