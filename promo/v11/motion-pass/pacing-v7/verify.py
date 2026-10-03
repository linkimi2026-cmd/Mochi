"""Encoded continuity checks. These do not certify musical taste or semantic pacing."""
import json,re,subprocess
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parent.parent
timeline=json.loads((root/'timeline.json').read_text())
variants=json.loads((root/'music-variants.json').read_text())
assert timeline['edition']==7 and variants['versionCount']==2
assert {x['label'] for x in variants['outputs']}=={'现有配乐版','K2.5参考音轨版'}
source=timeline['output']
raw=subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',source])
pts=np.array([float(x['best_effort_timestamp_time']) for x in json.loads(raw)['frames']])
gaps=np.diff(pts)
assert len(pts)==round(timeline['duration']*120)
assert np.all(gaps>0) and np.max(gaps)<.008335
scan=subprocess.run(['ffmpeg','-hide_banner','-i',source,'-vf','fps=15,scale=320:180,freezedetect=n=0.0005:d=1.5,blackdetect=d=0.08:pix_th=0.04','-an','-f','null','-'],capture_output=True,text=True,check=True)
lines=[s for s in scan.stderr.splitlines() if ('freeze_' in s or 'black_start:' in s)]
(root/'evidence/pacing-v7/encoded-scan.log').write_text('\n'.join(lines)+'\n')
freezes=[];current={}
for line in lines:
 for kind,value in re.findall(r'(freeze_start|freeze_duration|freeze_end): ([0-9.]+)',line):
  current[kind]=float(value)
  if kind=='freeze_end':freezes.append(current);current={}
if current:
 current['freeze_end']=timeline['duration'];current['freeze_duration']=timeline['duration']-current['freeze_start'];freezes.append(current)
black=[s for s in lines if 'black_start:' in s]
audio=[]
for v in variants['outputs']:
 data=subprocess.check_output(['ffmpeg','-v','error','-i',v['path'],'-map','0:a:0','-f','f32le','-ac','2','-ar','48000','-'])
 samples=np.frombuffer(data,dtype='<f4');peak=float(np.max(np.abs(samples)))
 assert np.isfinite(samples).all() and peak<1
 audio.append({'label':v['label'],'encodedPeak':peak,'finite':True,'decodeErrors':v['decodeErrors']})
report={'edition':7,'width':2560,'height':1440,'fps':120,'duration':timeline['duration'],'frames':len(pts),'minPtsGap':float(np.min(gaps)),'maxPtsGap':float(np.max(gaps)),'nonMonotonicPts':0,'pictureIdenticalAcrossVersions':variants['pictureIdentical'],'audio':audio,'freezeScan':{'sampleFps':15,'resolution':[320,180],'noiseThreshold':.0005,'minimumSeconds':1.5,'intervals':freezes,'blackIntervals':black},'pacingAudit':'pacing-v7/pacing-audit.json','artisticApproval':False,'manualListeningVerified':False}
(root/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
(root/'audio-validation.json').write_text(json.dumps({'edition':7,'tracks':audio,'manualListeningVerified':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
assert not freezes and not black,'Inspect the reported interval before delivery; do not waive the gate.'
