"""Measure rendered music energy attacks near editorial cues; never label this listening approval."""
import json, subprocess
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent
report=json.loads((root/'score-sync.json').read_text())
for track in report['reports']:
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(root/'assets/scores'/track['label']/('aligned-corrected.wav' if report.get('localAttackEdits') else 'aligned.wav')),'-ac','1','-ar','48000','-f','f32le','-'])
 a=np.frombuffer(raw,dtype='<f4');hop=240
 # 5ms windows, so the reported measurement resolution is coarser than 120fps output.
 energy=np.sqrt(np.mean(a[:len(a)//hop*hop].reshape(-1,hop)**2,axis=1))
 rise=np.maximum(0,np.diff(energy,prepend=0))
 checks=[]
 for cue in track['mapping'][1:-1]:
  k=round(cue['target']*48000/hop);lo=max(0,k-16);hi=min(len(rise),k+17)
  peak=lo+int(np.argmax(rise[lo:hi]));offset=peak*hop/48000-cue['target']
  checks.append({'cueSeconds':cue['target'],'nearbyAttackSeconds':peak*hop/48000,'offsetMs':round(offset*1000,2),'rise':float(rise[peak])})
 track['renderedAttackChecks']=checks
 track['maxMeasuredLocalOffsetMs']=max(abs(x['offsetMs']) for x in checks)
report['measurement']='Largest positive RMS attack within +/-80ms, 5ms resolution. This is a bounded local measurement, not proof of musical downbeat or listening approval.'
(root/'score-sync.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print([(t['label'],t['maxTempoChange'],t['maxMeasuredLocalOffsetMs'])for t in report['reports']])
