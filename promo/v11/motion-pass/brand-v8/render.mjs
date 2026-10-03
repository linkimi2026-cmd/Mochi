import {mkdirSync,openSync,closeSync,existsSync} from 'node:fs';
import {execFileSync}from'node:child_process';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),bin=resolve(dir,'../../../node_modules/.bin/hyperframes');
for(const id of process.argv.slice(2)){
 const folder=id.startsWith('bridge-')?resolve(dir,'bridges',id.slice(7)):resolve(dir,id);mkdirSync(resolve(folder,'output'),{recursive:true});
 if(id==='greeting'){
  const source=resolve(dir,'opening/output/video.mp4');
  if(!existsSync(source))throw Error('Render opening before greeting');
  execFileSync('ffmpeg',['-v','error','-nostdin','-ss','2','-i',source,'-t','2','-an','-c:v','libx264','-preset','fast','-crf','17','-r','120','-pix_fmt','yuv420p','-y',resolve(folder,'assets/incoming.mp4')],{stdio:'inherit'});
 }
 const log=openSync(resolve(folder,'render.log'),'w'),output=resolve(folder,'output/video.mp4');
 console.log('Rendering',id,new Date().toISOString());
 try{execFileSync(bin,['render',folder,'--fps','120','--quality','standard','--crf','17','--workers','1','--low-memory-mode','--output',output],{stdio:['ignore',log,log]})}finally{closeSync(log)}
 if(!existsSync(output))throw Error('Missing render '+id);console.log('Done',id,new Date().toISOString());
}
