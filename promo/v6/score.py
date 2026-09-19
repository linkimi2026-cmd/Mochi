from pathlib import Path
import subprocess,json
O=Path(__file__).resolve().parent
# One continuous 100-second passage. No loop, concat, or recycled musical section.
cues=json.loads((O/'audio-cues.json').read_text())
accents=cues['accents'];clicks=cues['clicks']
filters=[];labels=['[0:a]']
for idx,(events,kind) in enumerate([(accents,'accent'),(clicks,'click')],1):
 filters.append(f'[{idx}:a]asplit={len(events)}'+''.join(f'[{kind}{i}]' for i in range(len(events))))
 for i,(t,name) in enumerate(events):
  tag=f'{kind}delay{i}';filters.append(f'[{kind}{i}]adelay={round(t*1000)}:all=1[{tag}]');labels.append(f'[{tag}]')
filters.append(''.join(labels)+f'amix=inputs={len(labels)}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=8,afade=t=out:st=98:d=2,aresample=48000,asetpts=PTS-STARTPTS,apad=whole_dur=100,atrim=duration=100[out]')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(O/'assets/music-release.wav'),'-f','lavfi','-i','sine=frequency=95:duration=0.14:sample_rate=48000,afade=t=out:st=0.015:d=0.125,volume=0.6','-f','lavfi','-i','sine=frequency=1500:duration=0.025:sample_rate=48000,afade=t=out:st=0:d=0.025,volume=0.2','-filter_complex',';'.join(filters),'-map','[out]','-t','100','-ar','48000','-ac','2',str(O/'assets/music.wav')],check=True)
