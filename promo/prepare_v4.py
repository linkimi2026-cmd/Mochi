from pathlib import Path
import subprocess,json,concurrent.futures,shutil
B=Path(__file__).resolve().parent; A=B/'v4/assets'; A.mkdir(exist_ok=True,parents=True)
for name in ['gsap.min.js','NotoSansCJKsc-Regular.otf']:
 shutil.copy2(B/'v3/assets'/name,A/name)
M=json.loads((B/'assets/live/edit-map.json').read_text())
spec={'home':(3,None),'setup':(4,None),'campus':(4,None),'ask':(9,(610,680,3040,1480)),'approve':(10,(610,680,3040,1480))}
def make(item):
 n,(duration,crop)=item; dst=A/f'{n}.mp4'
 vf=f'setpts={duration/M[n]["duration"]}*(PTS-STARTPTS),'
 vf+=('crop='+':'.join(map(str,(crop[2],crop[3],crop[0],crop[1])))+',scale=2432:1184' if crop else 'scale=2560:1440')+',fps=30'
 if not dst.exists():subprocess.run(['ffmpeg','-v','error','-y','-safe','0','-f','concat','-i',str(B/f'assets/live/{n}.ffconcat'),'-vf',vf,'-t',str(duration),'-an','-c:v','libx264','-preset','fast','-crf','15',str(dst)],check=True)
 return n,dict(duration=duration,crop=crop,source='original 3840x2160 PNG sequence',events=[dict(e,t=e['t']*duration/M[n]['duration']) for e in M[n]['events']])
meta=dict(concurrent.futures.ThreadPoolExecutor(max_workers=2).map(make,spec.items()))
for n in ['find-peer-clean','find-teacher-clean','classroom-refined-received','agent-presets']:
 src=B/'captures/v3'/n; timing=json.loads((src/'timing.json').read_text()); length=timing[-1]['t']; duration={'find-peer-clean':4,'find-teacher-clean':5,'classroom-refined-received':4,'agent-presets':3}[n]
 concat=A/f'{n}.ffconcat'; chunks=['ffconcat version 1.0']
 for i,r in enumerate(timing):
  chunks.extend([f"file '{src / (str(r['frame']).zfill(5)+'.png')}'",f"duration {(timing[i+1]['t']-r['t']) if i+1<len(timing) else .12}"])
 concat.write_text('\n'.join(chunks)); dst=A/f'{n}.mp4'
 if not dst.exists():subprocess.run(['ffmpeg','-v','error','-y','-safe','0','-f','concat','-i',str(concat),'-vf',f'setpts={duration/length}*(PTS-STARTPTS),fps=30','-t',str(duration),'-an','-c:v','libx264','-preset','fast','-crf','15',str(dst)],check=True)
 meta[n]=dict(duration=duration,source='original 2560x1440 PNG sequence',events=[])
subprocess.run(['pdftoppm','-scale-to','2800','-png',str(B/'evidence/v3-refined-render/presentation.pdf'),str(A/'slide')],check=True)
subprocess.run(['pdftoppm','-scale-to','2400','-png',str(B/'inputs/校园节水调查-课堂练习.pdf'),str(A/'exam')],check=True)
(A/'media-map.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2))
print('V4 source media ready')
