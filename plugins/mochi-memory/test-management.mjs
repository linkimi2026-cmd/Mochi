import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, openStore } from './mem-store.mjs';
import { openWorldState } from './world-state.mjs';
import { installMemoryManagement } from './management.mjs';

test('管理API复用原库，敏感内容拒写、旧编辑冲突、固定、更正、忘记与约定同步',async t=>{
  const root=mkdtempSync(join(tmpdir(),'mochi-memory-ui-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const store=createStore(openStore(join(root,'memory.sqlite'))),world=openWorldState(join(root,'world'));
  t.after(()=>store.db.close());const routes=new Map();
  installMemoryManagement({connection:{fetch:{register:entry=>{routes.set(entry.path,entry);return()=>{};}}}},store,world);
  const call=async(path,body)=>{const response=await routes.get('/api/mochi-memory'+path).fetch(new Request('http://localhost/api/mochi-memory'+path,{method:body?'POST':'GET',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}));return{status:response.status,...await response.json()};};
  assert.equal((await call('/save',{kind:'preference',content:'我的密码是 123'})).status,400);
  let result=await call('/save',{kind:'convention',content:'星期一读书分享'});assert.equal(result.status,200);
  let row=result.rows[0];assert.equal(row.source,'explicit_request');assert.match(world.readWorldState(),/星期一读书分享/);
  assert.equal((await call('/save',{id:row.id,expected:'错误旧值',content:'新的约定'})).status,400);
  result=await call('/pin',{id:row.id,expected:row.content,pinned:true});assert.equal(result.rows[0].pinned,1);
  result=await call('/save',{id:row.id,expected:row.content,content:'星期二读书分享'});row=result.rows[0];
  assert.equal(row.pinned,1);assert.doesNotMatch(world.readWorldState(),/星期一读书分享/);assert.match(world.readWorldState(),/星期二读书分享/);
  assert.equal((await call('/forget',{id:row.id,expected:row.content})).status,400);
  result=await call('/forget',{id:row.id,expected:row.content,confirmed:true});assert.equal(result.rows.length,0);
  assert.doesNotMatch(world.readWorldState(),/星期二读书分享/);
  assert.equal(store.recall('读书分享').memories.length,0);
});
