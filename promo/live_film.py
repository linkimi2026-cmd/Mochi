from pathlib import Path
import json,subprocess,math,shutil
B=Path(__file__).resolve().parent; R=B/'recordings/live-v2'; A=B/'assets/live'; A.mkdir(exist_ok=True)
# Editing uses recorded frames in order. Long unrecorded gaps are explicit cuts.
specs=[('home','home-hd',0,None,4),('setup','setup-hd',0,13,5),('model','model-wide-hd',0,None,10),('typing','quiz',1,44,7),('generation','quiz',44,675,10),('quiz','quiz-hd',0,None,10),('campus','campus-hd',0,10,6),('ask','ask-mochi-hd',0,None,15),('approve','release-approve-hd',0,None,18),('a2asend','a2a-send-hd',0,None,14),('a2areply','a2a-reply-hd',0,None,16),('a2areturn','a2a-return-hd',0,None,15)]
out={}
for name,src,lo,hi,dur in specs:
 j=json.loads((R/f'{src}.json').read_text());fs=j['frames'][lo:hi];dt=[];ts=[0]
 for a,b in zip(fs,fs[1:]):dt.append(min(max(b['t']-a['t'],.04),1.0));ts.append(ts[-1]+dt[-1])
 hold=3.5 if name in ["ask","approve","a2asend","a2areply","a2areturn"] else 0
 dt.append(.7);ratio=(dur-hold)/sum(dt);dt=[v*ratio for v in dt];ts=[v*ratio for v in ts];dt[-1]+=hold
 def mt(t):
  for i in range(len(fs)-1):
   if fs[i]['t']<=t<fs[i+1]['t']:
    delta=fs[i+1]['t']-fs[i]['t'];return ts[i]+(max(0,dt[i]-.15) if delta>1 else (t-fs[i]['t'])/delta*dt[i])
  return max(0,min(dur,t-fs[0]['t']))
 events=[]
 for e in j['events']:
  if 'x' in e and fs[0]['t']-.4<=e['t']<=fs[-1]['t']:
   z=dict(e);z['t']=mt(e['t']);
   if src=='model-wide-hd':z['x']-=550 # original recorder closure retained pre-resize iframe offset (1602 vs 1052)
   events.append(z)
 if name=='typing':events=[{'type':'click','name':'发送需求','x':1349.398,'y':843,'t':dur-.5}]
 lines=['ffconcat version 1.0']
 for f,d in zip(fs,dt):lines += [f"file '{R/f['file']}'",f'duration {d:.6f}']
 lines += [f"file '{R/fs[-1]['file']}'"]
 q=A/f'{name}.ffconcat';q.write_text('\n'.join(lines));target=A/f'{name}.mp4'
 if name in ["ask","approve","a2asend","a2areply","a2areturn"]:
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-safe','0','-i',str(q),'-t',str(dur),'-vf','fps=15,format=yuv420p','-c:v','libx264','-preset','fast','-crf','14','-an',str(target)],check=True)
 out[name]={'duration':dur,'events':events,'source':src,'frames':[lo,hi],'cuts':'gaps over 1 second shortened','size':[1600,900] if src=='quiz' else [1920,1080]}
 print(name,'ready',flush=True)
(A/'edit-map.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
