import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('../src/',import.meta.url);
const bundle = await build({stdin:{contents:`export * from './bloub-motion'; export * from './vendor/bloub/engine'; export * from './vendor/bloub/states'; export * from './vendor/bloub/face';`,resolveDir:base.pathname},bundle:true,write:false,format:'esm',platform:'node'});
const {BotEngine,STATES,MOTION_SCRIPTS,motionAt,pointerLook,eyePoses} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('vendored engine is unchanged from the pinned MIT upstream',()=>{
 const source=JSON.parse(readFileSync(new URL('vendor/bloub/SOURCE.json',base)));
 for(const [file,hash] of Object.entries(source.sha256)) assert.equal(createHash('sha256').update(readFileSync(new URL('vendor/bloub/'+file,base))).digest('hex'),hash,file);
});
test('all 14 upstream actions plus swirl are mapped, with complete phase durations',()=>{
 const covered=new Set();
 for(const [name,script] of Object.entries(MOTION_SCRIPTS)) {
   covered.add(script.rest);
   for(const [id,length] of script.phases){covered.add(id);assert.ok(length>=(STATES.find(s=>s.id===id).minDuration??0),name+':'+id);}
   assert.ok(STATES.some(s=>s.id===motionAt(name,200)));
 }
 assert.deepEqual([...covered].sort(),STATES.map(s=>s.id).sort());
});
test('every state stays deterministic and finite across sampled animation frames',()=>{
 for(const state of STATES){
  const engine=new BotEngine(100,state.id);
  for(let i=0;i<150;i++){
   const t=i/30;const frame=engine.sample(t);const json=JSON.stringify(frame);
   assert.ok(!/NaN|Infinity|null/.test(JSON.stringify([frame.bodyPath,frame.eyes,frame.dots,frame.arcs])),state.id);
   assert.equal(JSON.stringify(engine.sample(t)),json,state.id+' determinism');
   assert.ok(frame.bodyAlpha>=0&&frame.bodyAlpha<=1);
  }
 }
});
test('a rapidly interrupted state transition preserves the current body pose',()=>{
 const engine=new BotEngine(100,'idle');engine.setState('orbit',1);engine.setState('burst',1.1);
 const before=engine.sample(1.17).bodyPath;engine.setState('thinking',1.17);
 assert.equal(engine.sample(1.17).bodyPath,before);
 engine.setLook({yaw:20,pitch:-10,mix:1,spin:0,wander:0},1.2);
 assert.ok(!JSON.stringify(engine.sample(1.5)).includes('NaN'));
});

test('pointer tracking projects both eyes toward the cursor in all four directions',()=>{
 const box={x:100,y:200,width:160,height:160};
 for(const [x,y,axis,sign] of [[180,200,'y',-1],[180,360,'y',1],[100,280,'x',-1],[260,280,'x',1]]) {
  const gaze=pointerLook(x,y,box);
  const eyes=eyePoses({...gaze,roll:0},100);
  const center=(eyes[0][axis]+eyes[1][axis])/2;
  assert.ok(center*sign>0,`${x},${y}: projected ${axis}=${center}`);
 }
 assert.equal(pointerLook(0,0,{...box,width:0}),null);
 const far=pointerLook(10000,-10000,box);
 assert.equal(far.yaw,28); assert.equal(far.pitch,18);
});
