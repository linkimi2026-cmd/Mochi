from pathlib import Path
import json, subprocess, hashlib
from PIL import Image,ImageDraw
b=Path(__file__).resolve().parent
p=b/'output/Mochi_140秒_真实工作故事.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
v=next(x for x in probe['streams'] if x['codec_type']=='video');a=next(x for x in probe['streams'] if x['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'60/1')
assert abs(float(probe['format']['duration'])-140)<.1
assert int(v['nb_frames'])==8400
subprocess.run(['ffmpeg','-v','error','-i',str(p),'-f','null','-'],check=True,stderr=open(b/'evidence/v2-decode.log','w'))
out=b/'evidence/v2-rendered';out.mkdir(exist_ok=True)
times=[8,18,26,35,45,58,68,79,86,94,100,109,116,131,137]
canvas=Image.new('RGB',(1800,5*362),'#202020');draw=ImageDraw.Draw(canvas)
for i,t in enumerate(times):
 f=out/f'{t:03}.png'
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(p),'-frames:v','1',str(f)],check=True)
 im=Image.open(f);im.thumbnail((600,338));x=(i%3)*600;y=(i//3)*362;canvas.paste(im,(x,y+24));draw.text((x+8,y+5),f'{t}s',fill='white')
canvas.save(out/'contact-sheet.jpg',quality=94)
audit={'file':str(p),'duration':float(probe['format']['duration']),'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'frames':v['nb_frames'],'audio_codec':a['codec_name'],'audio_sample_rate':a['sample_rate'],'bytes':p.stat().st_size,'sha256':hashlib.file_digest(open(p,'rb'),'sha256').hexdigest(),'decode':'passed','composition_check':json.load(open(b/'evidence/v2-check.json'))['ok'],'actual_clicks':len(json.load(open(b/'assets/live/clicks.json'))),'sample_times':times,'visual_review':'pending','source_note':'Actual Mochi frames, source sampling below output 60fps; editorial mouse and camera overlays. Campus uses local demo data and two separate Mochi instances.'}
(b/'evidence/final-audit-v2.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2));print(json.dumps(audit,ensure_ascii=False,indent=2))
