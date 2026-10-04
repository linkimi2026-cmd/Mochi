from pathlib import Path
import subprocess,json,hashlib
b=Path(__file__).resolve().parent
p=b/'output/Mochi_V9_2K120_4m46s.mp4'
def run(*args):return subprocess.check_output(args,text=True)
meta=json.loads(run('ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)))
v=next(s for s in meta['streams'] if s['codec_type']=='video')
a=next(s for s in meta['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'])==(2560,1440)
assert v['r_frame_rate']==v['avg_frame_rate']=='120/1'
assert int(v['nb_frames'])==34320
assert abs(float(meta['format']['duration'])-286)<.1
assert a['sample_rate']=='48000' and a['channels']==2
frames=run('ffmpeg','-v','error','-ss','0.1','-i',str(p),'-t','0.5','-an','-f','framemd5','-')
hashes=[s.rsplit(',',1)[-1].strip() for s in frames.splitlines() if not s.startswith('#')]
assert len(hashes)==60 and len(set(hashes))>=55,(len(hashes),len(set(hashes)))
r={'file':p.name,'width':v['width'],'height':v['height'],'fps':v['avg_frame_rate'],'frames':int(v['nb_frames']),'duration':float(meta['format']['duration']),'videoCodec':v['codec_name'],'pixelFormat':v['pix_fmt'],'audioCodec':a['codec_name'],'audioSampleRate':a['sample_rate'],'audioChannels':a['channels'],'motionSampleFrames':len(hashes),'motionDistinctFrames':len(set(hashes)),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()}
(b/'evidence/final-video-verification.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(r,ensure_ascii=False,indent=2))
