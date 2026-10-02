"""Local musical edit: move measured attacks onto picture cues with 250ms crossfades.
The surrounding phrase stays intact; click sounds remain a separate shared stem.
"""
import json,subprocess
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent;report=json.loads((root/'score-sync.json').read_text());rate=48000
if report.get('localAttackEdits'):raise RuntimeError('Already edited. Re-run sync-scores and measure-sync before a fresh attack edit.')
for track in report['reports']:
 folder=root/'assets/scores'/track['label']
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(folder/'aligned.wav'),'-ac','2','-ar',str(rate),'-f','f32le','-'])
 original=np.frombuffer(raw,dtype='<f4').reshape(-1,2);edited=original.copy()
 for cue in track['renderedAttackChecks']:
  center=round(cue['cueSeconds']*rate);shift=round(cue['offsetMs']/1000*rate)
  left=max(0,center-int(.25*rate));right=min(len(edited),center+int(.25*rate));ix=np.arange(left,right)
  distance=np.abs(ix-center)/rate
  weight=np.where(distance<=.11,1,.5+.5*np.cos(np.pi*np.clip((distance-.11)/.14,0,1)))[:,None]
  shifted=original[np.clip(ix+shift,0,len(original)-1)]
  edited[left:right]=original[left:right]*(1-weight)+shifted*weight
 path=folder/'aligned-corrected.wav'
 subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(rate),'-ac','2','-i','-','-y',str(path)],input=edited.astype('<f4').tobytes(),check=True)
 subprocess.run(['ffmpeg','-v','error','-i',str(path),'-i',str(root/'assets/clicks.wav'),'-filter_complex','[0:a][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.9:level=false:latency=true[a]','-map','[a]','-ar',str(rate),'-ac','2','-y',str(folder/'final.wav')],check=True)
 track['attackEdits']=[{'time':c['cueSeconds'],'sourceShiftMs':c['offsetMs'],'blendHalfWidthMs':250,'unchangedCenterHalfWidthMs':110}for c in track['renderedAttackChecks']]
report['localAttackEdits']=True
(root/'score-sync.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
