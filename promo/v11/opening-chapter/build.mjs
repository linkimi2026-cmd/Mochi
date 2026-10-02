import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const dir=dirname(fileURLToPath(import.meta.url)), assets=resolve(dir,'assets');
mkdirSync(assets,{recursive:true});
for(const name of ['gsap.min.js','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf'])copyFileSync(resolve(dir,'../../v10/assets',name),resolve(assets,name));
for(const name of ['motion.js','motion.css'])copyFileSync(resolve(dir,'..',name),resolve(assets,name));
const shots=[
  {name:'home',source:'home-presets-clean.mov',ranges:[[82,4]]},
  {name:'scenes',source:'presets-controls.mov',ranges:[[43,6]]},
  {name:'examples',source:'examples-expanded.mov',ranges:[[43,4],[56,4]]},
];
for(const shot of shots){
  const source=resolve(dir,'../capture-private.nosync',shot.source);
  const chains=shot.ranges.map(([start,duration],i)=>`[0:v]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,crop=2160:1376:0:64,fps=60,setsar=1[v${i}]`);
  const concat=shot.ranges.length>1?`;${shot.ranges.map((_,i)=>`[v${i}]`).join('')}concat=n=${shot.ranges.length}:v=1:a=0[out]`:'';
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',source,'-filter_complex',chains.join(';')+concat,'-map',shot.ranges.length>1?'[out]':'[v0]','-an','-c:v','libx264','-crf','17','-preset','fast','-g','30','-keyint_min','30','-movflags','+faststart','-y',resolve(assets,shot.name+'.mp4')],{stdio:'inherit'});
  shot.sha256=createHash('sha256').update(readFileSync(source)).digest('hex');
}
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({sourceRoot:'../capture-private.nosync',crop:'2160:1376:0:64',conformFps:60,outputFps:120,shots},null,2)+'\n');

execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',resolve(dir,'../../v8/assets/music.wav'),'-t','18','-af','afade=t=in:d=0.25,afade=t=out:st=17.5:d=0.5,loudnorm=I=-17:TP=-1.5:LRA=8','-ar','48000','-ac','2','-y',resolve(assets,'music-review.wav')],{stdio:'inherit'});
