import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require=createRequire(import.meta.url),modules=resolve(import.meta.dirname,'../runtime-modern/node_modules');
const {migrateMimoConfig,migrateMimoPatch,consolidatePiAiPatch}=require('../resources/mochi-web/modern-models.cjs');
const yaml=createRequire(resolve(modules,'@deepseek-ai/dsh/package.json'))('yaml');
const config={apiKeyEnv:'FIXTURE_REF',baseURL:'http://127.0.0.1:9/v1',models:[{id:'legacy',name:'Legacy',contextWindow:123,maxTokens:456}]};
test('implicit legacy adapter levels survive migration without changing the model or route',()=>{
 const route=migrateMimoConfig(config).providers['mochi-mimo'];assert.deepEqual(route.models[0],{...config.models[0],reasoningEfforts:{off:null,low:'low',medium:'medium',high:'high',max:'max'}});assert.equal(route.baseURL,config.baseURL);assert.equal(route.apiKeyEnv,config.apiKeyEnv);
 assert.equal(migrateMimoConfig({...config,models:[{id:'disabled',reasoningEfforts:['off']}]}).providers['mochi-mimo'].models[0].reasoningEfforts,false);
});
test('existing migrated rows gain only missing capabilities; explicit modern restrictions survive',()=>{
 const route=migrateMimoConfig(config).providers['mochi-mimo'];
 for(const explicit of [undefined,false,{low:'low'}]){
  const existing=structuredClone(route);if(explicit===undefined)delete existing.models[0].reasoningEfforts;else existing.models[0].reasoningEfforts=explicit;
  const source=yaml.stringify([{id:'mochi-llm-mimo',name:'mochi-llm-mimo',config},{id:'llm-pi-ai',name:'@deepseek-ai/dsh-llm-pi-ai',config:{providers:{'mochi-mimo':existing}}}]);
  const migrated=migrateMimoPatch(source,modules),rows=yaml.parse(migrated),actual=rows.at(-1).config.providers['mochi-mimo'];
  assert.deepEqual(actual.models[0].reasoningEfforts,explicit??route.models[0].reasoningEfforts);assert.equal(migrateMimoPatch(migrated,modules),migrated);
 }
});
test('unrelated destination edits continue to reject rather than overwrite',()=>{
 const existing=migrateMimoConfig(config).providers['mochi-mimo'];existing.baseURL='http://127.0.0.1:10/v1';
 const source=yaml.stringify([{id:'mochi-llm-mimo',name:'mochi-llm-mimo',config},{id:'llm-pi-ai',config:{providers:{'mochi-mimo':existing}}}]);assert.throws(()=>migrateMimoPatch(source,modules),/冲突/);
});

test('already-disabled migration marker repairs missing capability on cold start and preserves explicit restrictions',()=>{
 const route=migrateMimoConfig(config).providers['mochi-mimo'];delete route.models[0].reasoningEfforts;
 const source=yaml.stringify([{id:'mochi-llm-mimo',name:'mochi-llm-mimo',disabled:true,config},{id:'llm-pi-ai',config:{providers:{'mochi-mimo':route}}}]);
 const migrated=migrateMimoPatch(source,modules);assert.deepEqual(yaml.parse(migrated)[1].config.providers['mochi-mimo'].models[0].reasoningEfforts,{off:null,low:'low',medium:'medium',high:'high',max:'max'});
 assert.equal(migrateMimoPatch(migrated,modules),migrated);
 route.models[0].reasoningEfforts=false;const explicit=yaml.stringify([{id:'mochi-llm-mimo',name:'mochi-llm-mimo',disabled:true,config},{id:'llm-pi-ai',config:{providers:{'mochi-mimo':route}}}]);assert.equal(migrateMimoPatch(explicit,modules),explicit);
 delete route.models[0].reasoningEfforts;route.baseURL='http://127.0.0.1:10/v1';const edited=yaml.stringify([{id:'mochi-llm-mimo',name:'mochi-llm-mimo',disabled:true,config},{id:'llm-pi-ai',config:{providers:{'mochi-mimo':route}}}]);assert.equal(migrateMimoPatch(edited,modules),edited);
});

test('disjoint pi-ai provider rows consolidate with exact models/ref/endpoint; duplicates must agree',()=>{
 const mimo=migrateMimoConfig(config).providers['mochi-mimo'];mimo.models[0].reasoningEfforts=false;
 const other={api:'openai-completions',baseURL:'http://127.0.0.1:19/v1',apiKeyEnv:'OTHER_REF',models:[{id:'other',reasoningEfforts:{off:null,high:'high'}}]};
 const source=yaml.stringify([{id:'llm-pi-ai',name:'@deepseek-ai/dsh-llm-pi-ai',config:{providers:{'mochi-mimo':mimo}}},{id:'llm-pi-ai',config:{providers:{other}}}]);
 const merged=consolidatePiAiPatch(source,modules),rows=yaml.parse(merged);assert.equal(rows.filter(r=>r.config?.providers).length,1);assert.deepEqual(rows.at(-1).config.providers,{'mochi-mimo':mimo,other});assert.equal(consolidatePiAiPatch(merged,modules),merged);
 const conflict=yaml.stringify([{id:'llm-pi-ai',config:{providers:{other}}},{id:'llm-pi-ai',config:{providers:{other:{...other,models:[{id:'different'}]}}}}]);assert.throws(()=>consolidatePiAiPatch(conflict,modules),/冲突.*原文件未修改/);
});
