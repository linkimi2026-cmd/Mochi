from pathlib import Path
import numpy as np,wave
sr=48000; duration=120; n=sr*duration
L=np.zeros(n,dtype=np.float32); R=np.zeros(n,dtype=np.float32)
rng=np.random.default_rng(20260913)
def add(start,seconds,freq,level=.1,pan=0,kind='pad'):
 a=int(start*sr); length=min(int(seconds*sr),n-a)
 if length<=0:return
 t=np.arange(length,dtype=np.float32)/sr
 if kind=='pad':
  v=(np.sin(2*np.pi*freq*t)+.22*np.sin(2*np.pi*freq*2.002*t)+.08*np.sin(2*np.pi*freq*3*t))*np.minimum(t/1.8,1)*np.minimum((seconds-t)/2,1)*level
 elif kind=='pluck':
  v=(np.sin(2*np.pi*freq*t)+.3*np.sin(2*np.pi*freq*2*t))*np.exp(-t*2.2)*np.minimum(t/.012,1)*level
 elif kind=='kick':v=np.sin(2*np.pi*(48*t+35*(1-np.exp(-t*25))/25))*np.exp(-t*13)*level
 else:v=rng.normal(size=length)*np.exp(-t*70)*level
 L[a:a+length]+=v*np.sqrt((1-pan)/2);R[a:a+length]+=v*np.sqrt((1+pan)/2)
beat=60/112; chords=[[50,57,62,64,69],[46,53,58,62,65],[53,60,65,69,72],[48,55,60,62,67]]
def hz(m):return 440*2**((m-69)/12)
for bar,start in enumerate(np.arange(0,114,beat*16)):
 chord=chords[bar%4]
 for j,m in enumerate(chord):add(start,beat*16+2,hz(m),.037,(j-2)*.23)
 for j in range(16):
  at=start+j*beat
  if at>=112:break
  level=.065 if 24<at<108 else .037
  if j%2==0:add(at,2,hz(chord[(j//2)%5]+12),level,(-1 if j%4==0 else 1)*.35,'pluck')
  if at>7 and j%4 in [0,2]:add(at,.4,48,.065 if at<108 else .02,0,'kick')
for at in [7,27,50,63,87,100,114]:
 for delay in [0,.12,.3]:add(at+delay,2.5,hz(81),.035,.2,'pluck')
for at in [36.1,39.7,50.4,62.1]:
 add(at,.065,1700,.13,0,'pluck')
fade=np.minimum(np.arange(n)/sr/2,1)*np.minimum((duration-np.arange(n)/sr)/4,1)
out=np.stack([L*fade,R*fade],axis=1);out=np.clip(out,-.9,.9)
with wave.open(str(Path(__file__).parent/'assets/score.wav'),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((out*32767).astype('<i2').tobytes())
