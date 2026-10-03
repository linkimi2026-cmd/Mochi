"""Check the exported K2.5 AAC against the validated music-only production mix."""
import hashlib,json,subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
root=Path(__file__).resolve().parent.parent
variants=json.loads((root/'music-variants.json').read_text())
output=next(x for x in variants['outputs'] if 'audioRevision' in x)
path=Path(output['path'])
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(path)]))
audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-map','0:a:0','-ar','48000','-ac','2','-f','f32le','-'])
actual=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
expected,sr=sf.read(root/'k25-audio-repair/media/final.wav',dtype='float32',always_2d=True)
assert sr==48000 and len(actual)>=len(expected)
# Subsample for a bounded-memory correlation; preserve both stereo channels.
correlation=float(np.corrcoef(actual[:len(expected):8].flatten(),expected[::8].flatten())[0,1])
assert correlation>.99 and float(audio['start_time'])==0
assert abs(float(audio['duration'])-variants['duration'])<.001
peak=float(np.abs(actual).max());assert peak<1 and np.isfinite(actual).all()
report={'output':str(path),'audioRevision':output['audioRevision'],'audioStart':audio['start_time'],'audioDuration':audio['duration'],'decodedSamplesPerChannel':len(actual),'aacTailPaddingSamples':len(actual)-len(expected),'correlationToValidatedMix':correlation,'decodedPeak':peak,'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'pictureMatchesCurrentMaster':variants['pictureIdenticalToMaster'],'decodeErrors':output['decodeErrors'],'manualListeningVerified':False}
(root/'k25-audio-repair/export-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
