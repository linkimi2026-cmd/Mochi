from pathlib import Path
import subprocess,json
O=Path(__file__).resolve().parent
# One continuous 80-second passage. No loop, concat, or recycled musical section.
accents=[(13.5,'课件展开'),(22.5,'模型就位'),(31.1,'答题反馈'),(47.12,'批准放行'),(57.5,'Agent协作'),(63.5,'教室收到'),(70.8,'预设展开'),(76.5,'Mochi已至')]
clicks=[(10.2,'发送课件需求'),(19.2,'发送模型需求'),(29.05,'发送练习需求'),(38.267,'发送学生查询'),(43.865,'发送放行需求'),(53.267,'回复老师')]
filters=[];labels=['[0:a]']
for idx,(events,kind) in enumerate([(accents,'accent'),(clicks,'click')],1):
 filters.append(f'[{idx}:a]asplit={len(events)}'+''.join(f'[{kind}{i}]' for i in range(len(events))))
 for i,(t,name) in enumerate(events):
  tag=f'{kind}delay{i}';filters.append(f'[{kind}{i}]adelay={round(t*1000)}:all=1[{tag}]');labels.append(f'[{tag}]')
filters.append(''.join(labels)+f'amix=inputs={len(labels)}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=8,afade=t=out:st=78:d=2[out]')
subprocess.run(['ffmpeg','-v','error','-y','-i',str(O/'assets/music-release.wav'),'-f','lavfi','-i','sine=frequency=95:duration=0.14:sample_rate=48000,afade=t=out:st=0.015:d=0.125,volume=0.6','-f','lavfi','-i','sine=frequency=1500:duration=0.025:sample_rate=48000,afade=t=out:st=0:d=0.025,volume=0.2','-filter_complex',';'.join(filters),'-map','[out]','-t','80','-ar','48000','-ac','2',str(O/'assets/music.wav')],check=True)
(O/'audio-cues.json').write_text(json.dumps({'duration':80,'source':'Mixkit Tech House vibes, original contiguous 0–80s','loop':False,'accents':accents,'clicks':clicks},ensure_ascii=False,indent=2))
