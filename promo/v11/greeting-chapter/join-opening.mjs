import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const dir=resolve('promo/v11/greeting-chapter');
execFileSync('ffmpeg',['-v','error','-nostdin','-i',resolve(dir,'output/greeting.mp4'),'-ss','1','-i',resolve(dir,'../opening-chapter/output/opening-presets.mp4'),'-filter_complex','[0:v]trim=duration=5,setpts=PTS-STARTPTS,setsar=1,fps=120[a];[1:v]trim=duration=17,setpts=PTS-STARTPTS,setsar=1,fps=120[b];[a][b]concat=n=2:v=1:a=0[v]','-map','[v]','-an','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','18000000','-pix_fmt','yuv420p','-video_track_timescale','15360','-y',resolve(dir,'output/greeting-and-opening.mp4')],{stdio:'inherit'});
