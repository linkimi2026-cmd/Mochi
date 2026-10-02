import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),assets=resolve(dir,'assets'),out=resolve(dir,'output');mkdirSync(out,{recursive:true});
const plan=JSON.parse(readFileSync(resolve(dir,'plan.json'))),chapters=plan.chapters,h=plan.handleSeconds;
const enc=['-an','-c:v','h264_videotoolbox','-b:v','18000000','-profile:v','high','-level:v','5.2','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-g','120','-video_track_timescale','15360'];
function ff(args){execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'})}
function probe(path){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}))}
chapters[chapters.length-1]={...chapters.at(-1),source:resolve(assets,'daily-with-ending.mp4'),start:0};
const reuse=process.argv.includes('--reuse-bodies');
const refresh=new Set((process.argv.find(x=>x.startsWith('--refresh-bridges='))?.split('=')[1]||'').split(',').filter(Boolean).map(Number));
const refreshBodies=new Set((process.argv.find(x=>x.startsWith('--refresh-bodies='))?.split('=')[1]||'').split(',').filter(Boolean).map(Number));
const parts=[],timeline=[];let cursor=0;
for(let i=0;i<chapters.length;i++){
 const c=chapters[i],skip=i?h:0,duration=c.duration-skip-(i<chapters.length-1?h:0),body=resolve(assets,`body-${i}.mp4`);
 if(!reuse||refreshBodies.has(i)||!existsSync(body))ff(['-ss',String(c.start+skip),'-i',c.source,'-t',String(duration),'-vf','fps=120,setsar=1',...enc,'-y',body]);
 parts.push(body);timeline.push({type:'chapter',name:c.name,start:cursor,duration,source:c.source,sourceStart:c.start+skip});cursor+=duration;console.log('body',i,duration);
 if(i<chapters.length-1){const bridge=resolve(dir,'bridges',String(i),'output/bridge.mp4'),normalized=resolve(assets,`bridge-${i}.mp4`);const p=probe(bridge),v=p.streams.find(s=>s.codec_type==='video');if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1'||Math.abs(Number(p.format.duration)-6)>.02)throw Error('bad bridge '+i);
 if(!reuse||refresh.has(i)||!existsSync(normalized))ff(['-i',bridge,'-t','6','-vf','fps=120,setsar=1',...enc,'-y',normalized]);parts.push(normalized);timeline.push({type:'mo-handoff',name:`Mo: ${c.name} → ${chapters[i+1].name}`,start:cursor,duration:6,source:bridge});cursor+=6;console.log('bridge',i);}
}
writeFileSync(resolve(assets,'concat.txt'),parts.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join('\n')+'\n');
ff(['-f','concat','-safe','0','-i',resolve(assets,'concat.txt'),'-an','-c:v','copy','-movflags','+faststart','-y',resolve(assets,'picture.mp4')]);
const music=resolve(dir,'../../v8/assets/music.wav');
ff(['-i',music,'-i',music,'-i',music,'-filter_complex',`[0:a][1:a]acrossfade=d=4:c1=qsin:c2=qsin[a];[a][2:a]acrossfade=d=4:c1=qsin:c2=qsin,atrim=duration=${cursor},asetpts=PTS-STARTPTS,loudnorm=I=-17:TP=-1.5:LRA=8,afade=t=in:d=1,afade=t=out:st=${cursor-3}:d=3[m]`,'-map','[m]','-ar','48000','-ac','2','-y',resolve(assets,'score.wav')]);
const edition=process.argv.includes('--edition=3')?3:2;
const final=resolve(out,edition===3?'Mochi_V11_第三版_叮咚小信箱与协作接力_2K120.mp4':'Mochi_V11_第二版_Mo贯穿与原生查人_2K120.mp4');
ff(['-i',resolve(assets,'picture.mp4'),'-i',resolve(assets,'score.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-t',String(cursor),'-movflags','+faststart','-metadata',`title=Mochi · 第${edition}版审片`,'-y',final]);
const p=probe(final),v=p.streams.find(s=>s.codec_type==='video');if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1'||Math.abs(Number(p.format.duration)-cursor)>.03)throw Error('export mismatch');
writeFileSync(resolve(dir,'timeline.json'),JSON.stringify({output:final,edition,width:2560,height:1440,fps:120,duration:cursor,chapters:timeline},null,2)+'\n');
writeFileSync(resolve(dir,'evidence/export.json'),JSON.stringify(p,null,2)+'\n');console.log(final,cursor);
