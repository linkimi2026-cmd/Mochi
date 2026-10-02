import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),timeline=JSON.parse(readFileSync(resolve(dir,'timeline.json'))),duration=timeline.duration;
const source=timeline.output,reference='/Users/a1379/Desktop/AI模型宣传视频/Kimi_K3_智能的新前沿.mp4';
const ff=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'});
const probe=p=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',p],{encoding:'utf8'}));
const k3Score=resolve(dir,'assets/scores/k3/delivery-final.wav');
const outputs=[];
for(const [label,audio]of [['现有配乐版',resolve(dir,'assets/scores/own/delivery-final.wav')],['K3参考音轨版',k3Score]]){
 const output=resolve(dir,`output/Mochi_V11_第三版_${label}_2K120.mp4`);
 ff(['-i',source,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','256k','-t',String(duration),'-movflags','+faststart','-metadata',`title=Mochi · 第三版 · ${label}`,'-y',output]);
 const p=probe(output),v=p.streams.find(s=>s.codec_type==='video');
 if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1'||Number(v.nb_frames)!==Math.round(duration*120))throw Error('Invalid variant '+label);
 const hash=execFileSync('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
 const decode=spawnSync('ffmpeg',['-v','error','-i',output,'-f','null','-'],{encoding:'utf8'});if(decode.status||decode.stderr.trim())throw Error('Variant decode failed');
 outputs.push({label,path:output,bytes:statSync(output).size,duration:Number(p.format.duration),frames:Number(v.nb_frames),videoBitstreamHash:hash,decodeErrors:0});
}
if(outputs[0].videoBitstreamHash!==outputs[1].videoBitstreamHash)throw Error('Pictures differ');
writeFileSync(resolve(dir,'music-variants.json'),JSON.stringify({reference,userRequestedTwoVersions:true,pictureIdentical:true,k3Audio:'Original local reference audio, looped and aligned to measured beats; not an isolated music stem; may include original sound effects.',clicks:'Same original Mochi press/release sounds in both variants; see choreography-cues.json',syncReport:'score-sync.json',duration,outputs},null,2)+'\n');
console.log(outputs.map(x=>x.path).join('\n'));
