import {mkdirSync,writeFileSync,copyFileSync,existsSync,symlinkSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)),out=resolve(dir,'native-query'),assets=resolve(out,'assets');mkdirSync(assets,{recursive:true});
const clips=[
 {name:'send',source:'../capture-private.nosync/native-student-query.mov',start:6,duration:7,crop:'2160:1376:0:64'},
 {name:'process',source:'../capture-private.nosync/native-student-query.mov',start:27,duration:12,crop:'1580:1070:560:178',speed:2},
 {name:'result',source:'../capture-private.nosync/native-student-result.mov',start:50,duration:7,crop:'2160:1376:0:64'},
 {name:'close',source:'../capture-private.nosync/native-student-result.mov',start:60,duration:10,pad:2,crop:'1530:630:600:180'},
 {name:'pending',source:'../master-preview/supplement/output/continuation.mp4',start:20,duration:8,crop:'2560:1440:0:0'},
];
for(const n of ['gsap.min.js','native.js','native.css','palettes.css','NotoSansCJKsc-Regular.otf','NotoSansCJKsc-Bold.otf','NotoSerifCJKsc-SemiBold.otf']){const p=resolve(assets,n);if(!existsSync(p))symlinkSync(resolve(dir,'assets',n),p)}
for(const n of ['motion.js','motion.css'])copyFileSync(resolve(dir,'..',n),resolve(assets,n));
for(const c of clips)execFileSync('ffmpeg',['-v','error','-ss',String(c.start),'-i',resolve(dir,c.source),'-t',String(c.duration/(c.speed||1)+(c.pad||0)),'-vf',`crop=${c.crop},setpts=(PTS-STARTPTS)/${c.speed||1},fps=60,setsar=1${c.pad?',tpad=stop_mode=clone:stop_duration='+c.pad:''}`,'-an','-c:v','libx264','-crf','17','-preset','fast','-g','30','-y',resolve(assets,c.name+'.mp4')],{stdio:'inherit'});
const sources=[...new Set(clips.map(c=>resolve(dir,c.source)))];writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify({clips,dataMode:'cloud-demo',student:'DEMO001',verifiedAnswer:'医务室（留观中）',queryCompleteSeconds:162,sourceNotice:'真实隔离演示记录；结果来自医务事件，不是定位传感器；等待已剪辑压缩',sources:sources.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))},null,2)+'\n');
