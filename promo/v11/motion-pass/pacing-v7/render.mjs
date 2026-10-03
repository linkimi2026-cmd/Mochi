import {mkdirSync,openSync,closeSync,existsSync,copyFileSync,symlinkSync} from 'node:fs';
import {execFileSync}from'node:child_process';import{resolve,dirname,relative}from'node:path';import{fileURLToPath}from'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),bin=resolve(dir,'../../../node_modules/.bin/hyperframes');
for(const id of process.argv.slice(2)){
 const folder=resolve(dir,id);mkdirSync(resolve(folder,'output'),{recursive:true});
 if(id==='ending'){if(!existsSync(resolve(folder,'assets')))symlinkSync(relative(folder,resolve(dir,'../assets')),resolve(folder,'assets'));copyFileSync(resolve(dir,'ending.html'),resolve(folder,'index.html'))}
 const log=openSync(resolve(folder,'render.log'),'w'),output=resolve(folder,'output/video.mp4');
 console.log('Rendering',id,new Date().toISOString());
 try{execFileSync(bin,['render',folder,'--fps','120','--quality','standard','--crf','17','--workers','1','--low-memory-mode','--output',output],{stdio:['ignore',log,log]})}finally{closeSync(log)}
 if(!existsSync(output))throw Error('Missing render '+id);console.log('Done',id,new Date().toISOString());
}
