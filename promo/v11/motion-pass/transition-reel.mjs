import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const report=JSON.parse(readFileSync(resolve(root,'music-variants.json'))),timeline=JSON.parse(readFileSync(resolve(root,'timeline.json')));
const source=report.outputs.find(o=>o.label==='现有配乐版').path,folder=resolve(root,'assets/reel');mkdirSync(folder,{recursive:true});
const bridges=timeline.chapters.filter(c=>c.type==='mo-handoff'),files=[];
for(const i of [0,1,2,4,5,6]){
 const c=bridges[i],file=resolve(folder,`${i}.mp4`),duration=c.duration+2;
 execFileSync('ffmpeg',['-v','error','-nostdin','-ss',String(c.start-1),'-i',source,'-t',String(duration),'-map','0:v:0','-map','0:a:0','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','18000000','-pix_fmt','yuv420p','-af',`afade=t=in:d=0.025,afade=t=out:st=${duration-.025}:d=0.025`,'-c:a','aac','-b:a','256k','-video_track_timescale','15360','-y',file],{stdio:'inherit'});files.push(file);
}
writeFileSync(resolve(folder,'concat.txt'),files.map(f=>`file '${f}'`).join('\n'));
const output=resolve(root,'output/Mochi_V11_第六版_转场速览_2K120.mp4');
execFileSync('ffmpeg',['-v','error','-nostdin','-f','concat','-safe','0','-i',resolve(folder,'concat.txt'),'-c','copy','-movflags','+faststart','-y',output],{stdio:'inherit'});console.log(output);
