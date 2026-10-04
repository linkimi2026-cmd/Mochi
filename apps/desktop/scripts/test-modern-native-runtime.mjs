#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve,join } from 'node:path';
import { writeFileSync } from 'node:fs';

assert.ok(process.argv[2],'Pass the staged node_modules directory');
const modules=resolve(process.argv[2]),electron=process.argv[4]?resolve(process.argv[4]):createRequire(import.meta.url)('electron');
const code=`
const r=require('node:module').createRequire(${JSON.stringify(join(modules,'package.json'))});
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');db.exec('create table probe(v)');db.close();
const canvas=r('@napi-rs/canvas').createCanvas(20,20);if(!canvas.toBuffer('image/png').length)throw Error('Empty PNG');
const sherpa=r('sherpa-onnx-node');if(typeof sherpa.OfflineRecognizer!=='function')throw Error('Missing recognizer');
const win=process.platform==='win32';const p=r('node-pty').spawn(win?'cmd.exe':'/bin/sh',win?['/d','/c','echo mochi-pty-ok']:['-c','printf mochi-pty-ok'],{name:'xterm',cols:80,rows:20,cwd:require('node:os').tmpdir(),env:{...process.env}});
const timeout=setTimeout(()=>{p.kill();process.exit(2)},8000);
let output='';p.onData(value=>output+=value);p.onExit(event=>{clearTimeout(timeout);if(event.exitCode!==0||!output.includes('mochi-pty-ok'))process.exit(1);process.stdout.write('NATIVE_PROBE='+JSON.stringify({platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,sqlite:true,canvasPng:true,sherpaModuleLoaded:true,ptyChildExited:true,realAsrTested:false,physicalMicrophoneTested:false,probeExitExplicit:true})+'\\n',()=>process.exit(0));});`;
const result=await new Promise((done,reject)=>{
  const child=spawn(electron,['--expose-internals','-e',code],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>output+=value);
  child.once('error',reject);child.once('exit',(status,signal)=>status===0?done(output):reject(new Error(`Native probe exited with status ${status}, signal ${signal}:\n${output}`)));
});
const marker=result.split('\n').find(line=>line.startsWith('NATIVE_PROBE='));assert.ok(marker,result);
const evidence=JSON.parse(marker.slice('NATIVE_PROBE='.length));
if(process.argv[4])assert.equal(evidence.electron,'44.0.0','modern packaged runtime must use the reviewed Electron version');
if(process.argv[3])writeFileSync(resolve(process.argv[3]),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
