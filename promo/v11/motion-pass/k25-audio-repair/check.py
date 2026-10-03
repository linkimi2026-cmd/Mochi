"""Measure audio continuity; never claim that a signal check is a listening review."""
import hashlib, json, subprocess
from pathlib import Path
import numpy as np
HERE=Path(__file__).resolve().parent
report=json.loads((HERE/'edit-report.json').read_text())
def audio(path,filters=None,rate=48000,channels=2):
    args=['ffmpeg','-v','error','-i',str(path)]
    if filters: args += ['-af',filters]
    return np.frombuffer(subprocess.check_output(args+['-ar',str(rate),'-ac',str(channels),'-f','f32le','-']),dtype='<f4').reshape(-1,channels)
final=audio(HERE/'media/final.wav'); music=audio(HERE/'media/music.wav')
assert len(final)==round(report['duration']*48000),(len(final),report['duration'])
assert len(music)==len(final) and np.isfinite(final).all()
assert abs(final).max()<.99
low=audio(HERE/'media/music.wav','highpass=f=40,lowpass=f=180',12000,1).ravel()
hop=24;energy=np.sqrt(np.mean(low[:len(low)//hop*hop].reshape(-1,hop)**2,axis=1))
smooth=np.convolve(energy,np.ones(5)/5,'same');rise=smooth-np.roll(smooth,5)
checks=[]
for section in report['sections']:
    cue=section['target'];lo=round((cue-.10)/.002);hi=round((cue+.12)/.002)
    at=(lo+int(np.argmax(rise[lo:hi])))*.002
    checks.append({'cueSeconds':cue,'measuredLowDrumRise':round(at,4),'offsetMs':round((at-cue)*1000,2)})
    assert abs(at-cue)<.1,(cue,at)
scan=subprocess.run(['ffmpeg','-hide_banner','-i',str(HERE/'media/final.wav'),'-af','silencedetect=noise=-55dB:d=0.5','-f','null','-'],capture_output=True,text=True,check=True)
silence=[s for s in scan.stderr.splitlines() if 'silence_start:' in s or 'silence_end:' in s]
assert not silence,silence
# Examine waveform continuity at musical edit boundaries, not a replacement for hearing them.
diff=np.max(abs(np.diff(music,axis=0)),axis=1)
joins=[]
for s in report['sections']:
    n=round(s['target']*48000)
    joins.append({'time':s['target'],'largestSampleStepInCrossfade':float(diff[n-2880:n+96].max())})
result={'revision':report['revision'],'sampleRate':48000,'channels':2,'samplesPerChannel':len(final),
        'finalAudioSha256': hashlib.sha256((HERE/'media/final.wav').read_bytes()).hexdigest(),
        'duration':len(final)/48000,'peak':float(abs(final).max()),'finite':True,
        'longSilencesBelowMinus55dB':silence,'majorCueChecks':checks,
        'cueMethod':'Strongest low-drum rising energy near each musical anchor; not proof of musicological downbeats or full listening approval.',
        'joinContinuity':joins,'wholeTrackLargestSampleStep':float(diff.max()),
        'manualListeningVerified':False}
(HERE/'audio-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
