import {tracks} from './score-tracks.mjs';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),timeline=JSON.parse(readFileSync(resolve(dir,'timeline.json'))),duration=timeline.duration;
const source=timeline.output,references=tracks.filter(t=>t.id!=='own').map(t=>({track:t.id,path:t.source}));
const ff=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'});
const probe=p=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',p],{encoding:'utf8'}));
const outputs=[];
const editionName=timeline.edition===7?'第七版':timeline.edition===6?'第六版':'第五版';
for(const {id,label} of tracks){
 console.log('Exporting',label);
 const audio=resolve(dir,`assets/scores/${id}/typed-final.wav`);
 const output=resolve(dir,`output/Mochi_V11_${editionName}_${label}_2K120.mp4`);
 ff(['-i',source,'-i',audio,'-i',resolve(dir,'output/Mochi_品牌封面_2K.png'),'-map','0:v:0','-map','1:a:0','-map','2:v:0','-c:v','copy','-disposition:v:1','attached_pic','-c:a','aac','-b:a','256k','-t',String(duration),'-movflags','+faststart','-metadata',`title=Mochi · ${editionName} · ${label}`,'-y',output]);
 const p=probe(output),v=p.streams.find(s=>s.codec_type==='video');
 if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1'||Number(v.nb_frames)!==Math.round(duration*120))throw Error('Invalid variant '+label);
 const hash=execFileSync('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
 console.log('Decoding',label);
 const decode=spawnSync('ffmpeg',['-v','error','-i',output,'-f','null','-'],{encoding:'utf8'});if(decode.status||decode.stderr.trim())throw Error('Variant decode failed');
 const cover=p.streams.find(s=>s.disposition?.attached_pic===1);if(!cover||cover.width!==2560||cover.height!==1440)throw Error('Missing brand cover');
 outputs.push({coverEmbedded:true,label,path:output,bytes:statSync(output).size,duration:Number(p.format.duration),frames:Number(v.nb_frames),videoBitstreamHash:hash,decodeErrors:0});
}
if(!outputs.every(o=>o.videoBitstreamHash===outputs[0].videoBitstreamHash))throw Error('Pictures differ');
const sourceHash=execFileSync('ffmpeg',['-v','error','-i',source,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
if(outputs[0].videoBitstreamHash!==sourceHash)throw Error('Picture differs from master');
writeFileSync(resolve(dir,'music-variants.json'),JSON.stringify({references,edition:timeline.edition,versionCount:tracks.length,cover:'output/Mochi_品牌封面_2K.png',pictureIdentical:true,pictureIdenticalToMaster:true,referenceAudio:'Original local reference audio, looped and aligned to measured beats; not an isolated music stem; may include original sound effects.',clicks:'Same original Mochi press/release and typing sounds in all enabled variants; see choreography-cues.json',typingReport:'typing-cues.json',syncReport:'score-sync.json',duration,outputs},null,2)+'\n');
console.log(outputs.map(x=>x.path).join('\n'));
