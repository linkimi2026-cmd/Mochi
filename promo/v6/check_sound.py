from pathlib import Path
import json,subprocess,wave,array,math
O=Path(__file__).resolve().parent
p=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(O/'assets/music.wav')]))
assert abs(float(p['format']['duration'])-100)<.001
with wave.open(str(O/'assets/music.wav'),'rb') as f:
 rate=f.getframerate();channels=f.getnchannels();samples=array.array('h',f.readframes(f.getnframes()))
peak=max(abs(v) for v in samples)/32768
cues=json.loads((O/'audio-cues.json').read_text())
values=[]
for t,name in cues['accents']+cues['clicks']:
 a=int(t*rate)*channels;b=int((t+.14)*rate)*channels
 window=samples[a:b];rms=math.sqrt(sum(v*v for v in window)/len(window))/32768
 values.append({'time':t,'cue':name,'rmsDbFS':round(20*math.log10(max(rms,1e-9)),2)})
result={'duration':100,'sampleRate':rate,'channels':channels,'peakDbFS':round(20*math.log10(peak),2),'musicLooped':False,'cueWindows':values}
(O/'sound-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
