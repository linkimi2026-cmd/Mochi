import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const dir=resolve('promo/v11/delivery-chapter');
execFileSync('ffmpeg',['-v','error','-nostdin','-i',resolve(dir,'../teaching-chapter/output/teaching-artefacts.mp4'),'-i',resolve(dir,'output/delivery-fixed.mp4'),'-filter_complex','[0:v]trim=duration=22,setpts=PTS-STARTPTS,setsar=1,fps=120[a];[1:v]trim=duration=16,setpts=PTS-STARTPTS,setsar=1,fps=120[b];[a][b]concat=n=2:v=1:a=0[v]','-map','[v]','-an','-c:v','h264_videotoolbox','-b:v','18000000','-pix_fmt','yuv420p','-video_track_timescale','15360','-y',resolve(dir,'output/teaching-and-delivery.mp4')],{stdio:'inherit'});
