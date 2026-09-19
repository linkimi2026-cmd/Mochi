from pathlib import Path
import subprocess,json
B=Path(__file__).resolve().parents[1]
video=B/'output/Mochi_100秒_2K120帧_V6.mp4'
Q=B/'evidence/v6-final-qa';Q.mkdir(exist_ok=True,parents=True)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
(Q/'media.json').write_text(json.dumps(probe,ensure_ascii=False,indent=2))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(2560,1440,'120/1')
assert abs(float(probe['format']['duration'])-100)<.04
assert int(v['nb_frames'])==12000
with (Q/'decode.log').open('w') as f:subprocess.run(['ffmpeg','-v','error','-i',str(video),'-f','null','-'],stderr=f,check=True)
assert (Q/'decode.log').stat().st_size==0
subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-vf','fps=1/2,scale=640:360,tile=3x5','-frames:v','4',str(Q/'contact-%02d.jpg')],check=True)
for t in [1.25,1.45,14.7,19.5,24,27,30,40,42,46,52,61,69,76,83,85,89,94,95.2,98]:
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(Q/f'{t}.png')],check=True)
with (Q/'audio-and-black.log').open('w') as f:subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-af','ebur128=peak=true','-vf','blackdetect=d=0.05:pix_th=0.02','-f','null','-'],stderr=f,check=True)
print(json.dumps({'video':str(video),'duration':probe['format']['duration'],'width':v['width'],'height':v['height'],'frames':v.get('nb_frames'),'fps':v['r_frame_rate'],'audioRate':a['sample_rate'],'fullDecode':'PASS'},ensure_ascii=False))
