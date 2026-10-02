import {mkdirSync,openSync,closeSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),bin=resolve(dir,'../../node_modules/.bin/hyperframes');
const targets=process.argv.slice(2);if(!targets.length)throw Error('Pass native-query or bridge indices');
for(const target of targets){const part=['native-query','ending'].includes(target)?resolve(dir,target):resolve(dir,'bridges',target),out=resolve(part,'output');mkdirSync(out,{recursive:true});mkdirSync(resolve(dir,'evidence'),{recursive:true});const file=resolve(out,['native-query','ending'].includes(target)?target+'.mp4':'bridge.mp4'),log=openSync(resolve(dir,'evidence',`render-${target}.log`),'w');console.log('render',target);try{execFileSync(bin,['render',part,'--fps','120','--quality','standard','--crf','17','--workers','1','--low-memory-mode','--output',file],{stdio:['ignore',log,log]})}finally{closeSync(log)}if(!existsSync(file))throw Error('Renderer returned without output: '+file);const cache=resolve(dir,'assets/rendered');mkdirSync(cache,{recursive:true});copyFileSync(file,resolve(cache,String(target)+'.mp4'));console.log('done',file)}
