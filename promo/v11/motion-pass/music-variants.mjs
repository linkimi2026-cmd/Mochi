import {tracks} from './score-tracks.mjs';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),timeline=JSON.parse(readFileSync(resolve(dir,'timeline.json'))),duration=timeline.duration;
const source=timeline.output,references=tracks.filter(t=>t.id!=='own').map(t=>({track:t.id,path:t.source}));
const ff=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args],{stdio:'inherit'});
const probe=p=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',p],{encoding:'utf8'}));
const selected=process.argv.find(a=>a.startsWith('--track='))?.slice(8);
if(selected&&!tracks.some(t=>t.id===selected))throw Error('Unknown audio track '+selected);
const previous=selected?JSON.parse(readFileSync(resolve(dir,'music-variants.json'))):null;
if(previous&&(previous.edition!==timeline.edition||Math.abs(previous.duration-duration)>.001))throw Error('Cannot reuse variants from a different timeline');
const outputs=previous?previous.outputs.filter(o=>o.label!==tracks.find(t=>t.id===selected).label):[];
const sourceHash=execFileSync('ffmpeg',['-v','error','-i',source,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
const editionName=timeline.edition===7?'第七版':timeline.edition===6?'第六版':'第五版';
for(const {id,label} of tracks.filter(t=>!selected||t.id===selected)){
 console.log('Exporting',label);
 const repaired=id==='k25'&&timeline.edition===7;
 const repair=repaired?JSON.parse(readFileSync(resolve(dir,'k25-audio-repair/edit-report.json'))):null;
 if(repair&&(Math.abs(repair.duration-duration)>.001||repair.pictureBitstreamHash!==sourceHash||repair.referenceEffectsMixed!==false))throw Error('Rebuild separated K2.5 music for the current picture before exporting');
 const audio=repair?resolve(dir,'k25-audio-repair/media/final.wav'):resolve(dir,`assets/scores/${id}/typed-final.wav`);
 if(repair){
  const check=JSON.parse(readFileSync(resolve(dir,'k25-audio-repair/audio-check.json')));
  const audioHash=createHash('sha256').update(readFileSync(audio)).digest('hex');
  if(check.revision!==repair.revision||check.finalAudioSha256!==audioHash||repair.finalAudioSha256!==audioHash)throw Error('Check the current K2.5 mix before exporting');
 }
 const output=resolve(dir,`output/Mochi_V11_${editionName}_${repaired?'K2.5音轨修订版':label}_2K120.mp4`);
 ff(['-i',source,'-i',audio,'-i',resolve(dir,'output/Mochi_品牌封面_2K.png'),'-map','0:v:0','-map','1:a:0','-map','2:v:0','-c:v','copy','-disposition:v:1','attached_pic','-c:a','aac','-b:a','256k','-t',String(duration),'-movflags','+faststart','-metadata',`title=Mochi · ${editionName} · ${label}`,'-y',output]);
 const p=probe(output),v=p.streams.find(s=>s.codec_type==='video');
 if(v.width!==2560||v.height!==1440||v.avg_frame_rate!=='120/1'||Number(v.nb_frames)!==Math.round(duration*120))throw Error('Invalid variant '+label);
 const hash=execFileSync('ffmpeg',['-v','error','-i',output,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
 console.log('Decoding',label);
 const decode=spawnSync('ffmpeg',['-v','error','-i',output,'-f','null','-'],{encoding:'utf8'});if(decode.status||decode.stderr.trim())throw Error('Variant decode failed');
 const cover=p.streams.find(s=>s.disposition?.attached_pic===1);if(!cover||cover.width!==2560||cover.height!==1440)throw Error('Missing brand cover');
 outputs.push({coverEmbedded:true,label,path:output,bytes:statSync(output).size,duration:Number(p.format.duration),frames:Number(v.nb_frames),videoBitstreamHash:hash,decodeErrors:0,...(repair?{audioRevision:repair.revision,audioReport:'k25-audio-repair/edit-report.json'}:{})});
}
if(!outputs.every(o=>o.videoBitstreamHash===outputs[0].videoBitstreamHash))throw Error('Pictures differ');
if(outputs[0].videoBitstreamHash!==sourceHash)throw Error('Picture differs from master');
writeFileSync(resolve(dir,'music-variants.json'),JSON.stringify({references,edition:timeline.edition,versionCount:tracks.length,cover:'output/Mochi_品牌封面_2K.png',pictureIdentical:true,pictureIdenticalToMaster:true,referenceAudio:'K2.5 uses TIGER-DnR separated music only; reference effects/dialogue stems are excluded. Model separation may retain bleed; see k25-audio-repair/separation-check.json.',clicks:'Same original Mochi press/release and typing sounds in all enabled variants; see choreography-cues.json',typingReport:'typing-cues.json',syncReport:'score-sync.json',audioReportOverrides:{k25:'k25-audio-repair/edit-report.json'},duration,outputs},null,2)+'\n');
console.log(outputs.map(x=>x.path).join('\n'));
