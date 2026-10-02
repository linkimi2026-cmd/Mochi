"""Compare encoded endpoints with original handle media; no claim of artistic approval."""
import json,subprocess
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent
plan=json.loads((root/'plan.json').read_text());checks=[]
def pixels(file,n):
 metadata=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=nb_frames','-of','json',str(file)]));n=min(n,int(metadata['streams'][0]['nb_frames'])-1)
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-vf',f"select='eq(n,{n})',scale=640:360,format=gray",'-frames:v','1','-f','rawvideo','-'])
 a=np.frombuffer(raw,dtype=np.uint8);assert a.size==640*360,(file,n,a.size)
 return a.astype(float)/255
for i in [0,1,2,4,5,6]:
 folder=root/'bridges'/str(i);frames=round(plan['bridgeDurations'][i]*120)
 for side,n in [('out',0),('in',frames-1)]:
  delta=np.abs(pixels(folder/'output/bridge.mp4',n)-pixels(folder/f'assets/{side}.mp4',n))
  mae=float(np.mean(delta));checks.append({'bridge':i,'endpoint':side,'normalizedMeanAbsolutePixelError':mae});assert mae<.025,(i,side,mae)
(root/'transition-seams.json').write_text(json.dumps({'method':'640x360 grayscale endpoint comparison with original handle frame; mean absolute normalized error <0.025. Allows codec differences; does not replace motion/art review.','checks':checks},indent=2)+'\n');print(checks)
