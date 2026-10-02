import {execFileSync} from 'node:child_process';import{writeFileSync}from'node:fs';import{dirname,resolve}from'node:path';import{fileURLToPath}from'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),assets=resolve(dir,'assets');
const ff=a=>execFileSync('ffmpeg',['-v','error',...a],{stdio:'inherit'});
const enc=['-an','-c:v','h264_videotoolbox','-b:v','18000000','-pix_fmt','yuv420p','-g','120','-video_track_timescale','15360'];
ff(['-ss','36','-i',resolve(dir,'../master-preview/supplement/output/continuation.mp4'),'-t','48',...enc,'-y',resolve(assets,'daily-48.mp4')]);
ff(['-i',resolve(dir,'ending/output/ending.mp4'),'-t','8',...enc,'-y',resolve(assets,'ending-8.mp4')]);
writeFileSync(resolve(assets,'daily-concat.txt'),['daily-48.mp4','ending-8.mp4'].map(n=>`file '${n}'`).join('\n'));
ff(['-f','concat','-safe','0','-i',resolve(assets,'daily-concat.txt'),'-c','copy','-y',resolve(assets,'daily-with-ending.mp4')]);
