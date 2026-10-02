import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),assets=resolve(dir,'assets'),out=resolve(dir,'output');
for(const p of [assets,out])mkdirSync(p,{recursive:true});
const chapters=[
 ['暖心首页与预设','../opening-chapter/output/opening-presets.mp4'],
 ['多 Agent 与配色','../team-chapter/output/team-palette.mp4'],
 ['课件与教学成果','../teaching-chapter/output/teaching-artefacts.mp4'],
 ['交互模型','../model-chapter/output/model-journey.mp4'],
 ['教室消息与叫人','../student-chapter/output/student-chapter-paper-world.mp4'],
 ['校园、记忆、自动化与结尾','supplement/output/continuation.mp4'],
].map(([name,path])=>{const source=resolve(dir,path);const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',source],{encoding:'utf8'}));const v=probe.streams.find(s=>s.codec_type==='video');if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1')throw Error('unexpected input '+source);return{name,source,duration:Number(probe.format.duration)}});
const reuse=process.argv.includes('--reuse-encoded-parts');
const enc=['-an','-c:v','h264_videotoolbox','-b:v','18000000','-profile:v','high','-level:v','5.2','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-g','120','-video_track_timescale','15360'];
function ff(args){execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'})}
const overlap=.4,parts=[];let cursor=0;
for(const [i,c] of chapters.entries()){
 c.start=cursor;c.end=cursor+c.duration;cursor=c.end-(i<chapters.length-1?overlap:0);
 const body=resolve(assets,`body-${i}.mp4`),skip=i?overlap:0,duration=c.duration-skip-(i<chapters.length-1?overlap:0);
 if(!reuse||!existsSync(body))ff(['-ss',String(skip),'-i',c.source,'-t',String(duration),'-vf','fps=120,setsar=1',...enc,'-y',body]);parts.push(body);console.log('body',i);
 if(i<chapters.length-1){const next=chapters[i+1],transition=resolve(assets,`join-${i}.mp4`);if(!reuse||!existsSync(transition))ff(['-ss',String(c.duration-overlap),'-t',String(overlap),'-i',c.source,'-t',String(overlap),'-i',next.source,'-filter_complex',`[0:v]fps=120,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[a];[1:v]fps=120,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[b];[a][b]xfade=transition=fade:duration=${overlap}:offset=0,format=yuv420p[v]`,'-map','[v]','-t',String(overlap),...enc,'-y',transition]);parts.push(transition);console.log('join',i)}
}
writeFileSync(resolve(dir,'timeline.json'),JSON.stringify({width:2560,height:1440,fps:120,duration:cursor,overlap,chapters},null,2)+'\n');
writeFileSync(resolve(assets,'concat.txt'),parts.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join('\n')+'\n');
ff(['-f','concat','-safe','0','-i',resolve(assets,'concat.txt'),'-an','-c:v','copy','-movflags','+faststart','-y',resolve(assets,'picture.mp4')]);
const music=resolve(dir,'../../v8/assets/music.wav');
ff(['-i',music,'-i',music,'-i',music,'-filter_complex',`[0:a][1:a]acrossfade=d=4:c1=qsin:c2=qsin[a];[a][2:a]acrossfade=d=4:c1=qsin:c2=qsin,atrim=duration=${cursor},asetpts=PTS-STARTPTS,loudnorm=I=-17:TP=-1.5:LRA=8,afade=t=in:d=1,afade=t=out:st=${cursor-3}:d=3[m]`,'-map','[m]','-ar','48000','-ac','2','-y',resolve(assets,'score.wav')]);
const final=resolve(out,'Mochi_V11_第一版联片_2K120.mp4');
ff(['-i',resolve(assets,'picture.mp4'),'-i',resolve(assets,'score.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-t',String(cursor),'-movflags','+faststart','-metadata','title=Mochi · 第一版联片','-y',final]);
console.log(final);
