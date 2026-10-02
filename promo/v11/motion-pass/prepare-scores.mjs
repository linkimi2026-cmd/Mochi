import {tracks} from './score-tracks.mjs';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),duration=JSON.parse(readFileSync(resolve(dir,'plan.json'))).duration+25;
for(const {id:label,source} of tracks.filter(t=>!process.argv[2]||t.id===process.argv[2])){
 const part=resolve(dir,'assets/scores',label);mkdirSync(part,{recursive:true});
 const length=Number(JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',source],{encoding:'utf8'})).format.duration),count=Math.ceil((duration-2)/(length-2));
 const filters=[];let prev='0:a';for(let i=1;i<count;i++){filters.push(`[${prev}][${i}:a]acrossfade=d=2:c1=qsin:c2=qsin[c${i}]`);prev=`c${i}`}
 filters.push(`[${prev}]atrim=duration=${duration},asetpts=PTS-STARTPTS[a]`);
 execFileSync('ffmpeg',['-v','error','-nostdin',...Array.from({length:count},()=>['-i',source]).flat(),'-filter_complex',filters.join(';'),'-map','[a]','-ar','48000','-ac','2','-y',resolve(part,'music.wav')],{stdio:'inherit'});
 writeFileSync(resolve(part,'index.html'),`<!doctype html><html><body><main data-composition-id="${label}" data-width="2560" data-height="1440" data-duration="${duration}"><audio id="music" src="music.wav" data-start="0" data-duration="${duration}" data-timeline-role="music"></audio></main></body></html>`);
 execFileSync(resolve(dir,'../../node_modules/.bin/hyperframes'),['beats',part,'--json'],{stdio:'inherit'});
}
