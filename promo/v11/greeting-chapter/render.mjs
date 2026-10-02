import {mkdirSync,openSync,closeSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const dir=resolve('promo/v11/greeting-chapter');
mkdirSync(resolve(dir,'output'),{recursive:true});mkdirSync(resolve(dir,'evidence'),{recursive:true});
const out=resolve(dir,'output/greeting.mp4'),log=openSync(resolve(dir,'evidence/render.log'),'w');
try{execFileSync('promo/node_modules/.bin/hyperframes',['render',dir,'--fps','120','--quality','standard','--crf','17','--workers','1','--low-memory-mode','--output',out],{stdio:['ignore',log,log]})}finally{closeSync(log)}
if(!existsSync(out))throw Error('Renderer exited without output');
console.log(out);
