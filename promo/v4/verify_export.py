from pathlib import Path
import subprocess,json
B=Path(__file__).resolve().parents[1]
video=B/'output/Mochi_102秒_2K发布会版_V4_Kimi审片.mp4'
Q=B/'evidence/v4-final-qa';Q.mkdir(exist_ok=True,parents=True)
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)]))
(Q/'media.json').write_text(json.dumps(probe,ensure_ascii=False,indent=2))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(2560,1440,'60/1')
assert abs(float(probe['format']['duration'])-102)<.04
assert int(v['nb_frames'])==6120
with (Q/'decode.log').open('w') as f:subprocess.run(['ffmpeg','-v','error','-i',str(video),'-f','null','-'],stderr=f,check=True)
assert (Q/'decode.log').stat().st_size==0
subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-vf','fps=1/2,scale=640:360,tile=3x5','-frames:v','4',str(Q/'contact-%02d.jpg')],check=True)
for t in [1.8,8.8,14.5,24.5,30.8,32.6,37,44.5,54.7,58.8,63.7,66.5,71.5,76,81,86,94,100]:
 subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(Q/f'{t}.png')],check=True)
with (Q/'audio-and-black.log').open('w') as f:subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-af','ebur128=peak=true','-vf','blackdetect=d=0.05:pix_th=0.02','-f','null','-'],stderr=f,check=True)
release=B/'output/Mochi_102秒_2K发布会版_V4_网络传播备选.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-i',str(B/'v4/assets/music-release.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-t','102','-movflags','+faststart',str(release)],check=True)
release_probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(release)]))
(Q/'release-media.json').write_text(json.dumps(release_probe,ensure_ascii=False,indent=2))
assert abs(float(release_probe['format']['duration'])-102)<.04
with (Q/'release-decode.log').open('w') as f:subprocess.run(['ffmpeg','-v','error','-i',str(release),'-f','null','-'],stderr=f,check=True)
assert (Q/'release-decode.log').stat().st_size==0
print(json.dumps({'video':str(video),'releaseAlternative':str(release),'duration':probe['format']['duration'],'width':v['width'],'height':v['height'],'frames':v.get('nb_frames'),'fps':v['r_frame_rate'],'audioRate':a['sample_rate'],'fullDecode':'PASS'},ensure_ascii=False))
