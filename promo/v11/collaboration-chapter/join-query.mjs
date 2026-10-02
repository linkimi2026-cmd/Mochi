import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const dir=resolve('promo/v11/collaboration-chapter');
execFileSync('ffmpeg',['-v','error','-nostdin','-i',resolve(dir,'../motion-pass/native-query/output/native-query.mp4'),'-i',resolve(dir,'output/collaboration.mp4'),'-filter_complex','[0:v]trim=duration=30.65,setpts=PTS-STARTPTS,setsar=1,fps=120,settb=1/120[a];[1:v]trim=duration=30,setpts=PTS-STARTPTS,setsar=1,fps=120,settb=1/120[b];[a][b]xfade=transition=slideleft:duration=0.65:offset=30,format=yuv420p[v]','-map','[v]','-t','60','-an','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','18000000','-pix_fmt','yuv420p','-video_track_timescale','15360','-y',resolve(dir,'output/query-movement-a2a.mp4')],{stdio:'inherit'});
