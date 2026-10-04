import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {UserProfile} from '../store.mjs';
import {HolidayGreeting,holidayDay,readGreetingMemories} from '../holiday-greeting.mjs';
import {createStore,openStore} from '../../mochi-memory/mem-store.mjs';
const day=()=>new Date(2026,9,1,12).getTime();
function setup(t,{address='王老师',role='teacher',stream,memories=()=>[],now=day,idle=()=>true}={}){
 const root=mkdtempSync(join(tmpdir(),'mochi-holiday-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const profile=new UserProfile(role,root);if(address)profile.update({expectedRevision:0,changes:{[role==='teacher'?'preferredAddress':'classroomAddress']:address}});
 const calls=[];const service=new HolidayGreeting({profile,now,idle,memories,delayMs:100000,effort:async()=> 'off',route:()=>({provider:'fixture',model:'known'}),stream:stream??(async function*(options){calls.push(options);yield {type:'text-delta',text:'愿你按喜欢的节奏自在安排假期'};yield {type:'finish',reason:{kind:'stop'}};})});
 t.after(()=>service.close());const generate=async()=>{service.snapshot();clearTimeout(service.job?.timer);await service.generate();};return {service,profile,calls,root,generate};
}
test('real local festival date and static fallback are immediate; ordinary dates never request a model',async t=>{
 const h=setup(t);assert.match(h.service.snapshot().greeting,/国庆快乐/);assert.equal(h.calls.length,0);await h.generate();assert.equal(h.calls.length,1);assert.equal(h.calls[0].reasoningEffort,'off');assert.equal(h.service.snapshot().source,'model');assert.match(h.service.snapshot().greeting,/王老师/);assert.equal(statSync(h.service.path).mode&0o777,0o600);
 assert.equal(holidayDay(new Date(2026,9,2)).festival,null);const ordinary=setup(t,{now:()=>new Date(2026,9,2,12).getTime()});await ordinary.generate();assert.equal(ordinary.calls.length,0);
});
test('unnamed users can generate from bounded tentative habits without inventing a name',async t=>{
 const h=setup(t,{address:'',memories:()=>[{id:1,tentative:true,text:'暂定偏好简洁排版'}]});await h.generate();assert.equal(h.calls.length,1);assert.match(JSON.stringify(h.calls[0].messages),/tentative/);assert.match(h.calls[0].system,/不陈述确定班级特点/);assert.match(h.service.snapshot().greeting,/^国庆节，愿/);
});
test('memory change invalidates old text, caps every identity day, and persists counters across restart',async t=>{
 let facts=[];const h=setup(t,{memories:()=>facts});await h.generate();facts=[{id:1,text:'喜欢简洁'}];assert.equal(h.service.snapshot().source,'fallback');await h.generate();facts=[];assert.equal(h.service.snapshot().source,'fallback');await h.generate();assert.equal(h.calls.length,2);
 const saved=h.service.readCache();assert.equal(saved.entries[0].attempts,2);assert.ok(!readFileSync(h.service.path,'utf8').includes('喜欢简洁'));
 const restarted=new HolidayGreeting({profile:h.profile,now:day,memories:()=>facts,idle:()=>true,route:()=>({provider:'fixture',model:'known'}),stream:()=>{throw Error('must not call')}});t.after(()=>restarted.close());assert.equal(restarted.snapshot().source,'fallback');assert.equal(restarted.job,null);
});
test('identity changes never return old text or old global facts; in-flight old identity cannot overwrite',async t=>{
 let finish;const h=setup(t,{memories:after=>after?[]:[{id:1,text:'旧身份偏好'}],stream:async function*(options){await new Promise(resolve=>finish=resolve);yield {type:'text-delta',text:'愿你假期自在'};yield {type:'finish',reason:{kind:'stop'}};}});
 h.service.snapshot();clearTimeout(h.service.job.timer);const pending=h.service.generate();await new Promise(resolve=>setImmediate(resolve));h.profile.update({expectedRevision:1,changes:{preferredAddress:'李老师'}});finish();await pending;assert.equal(h.service.snapshot().source,'fallback');assert.ok(!h.service.readCache().entries.some(x=>x.text));
});
test('foreground work prevents starts and cancellation/failure immediately leaves persistent fallback',async t=>{
 let busy=true;const h=setup(t,{idle:()=>!busy});await h.generate();assert.equal(h.calls.length,0);busy=false;await h.generate();assert.equal(h.calls.length,1);
 const failure=setup(t,{stream:async function*(){throw Error('offline')}});await failure.generate();assert.equal(failure.service.snapshot().source,'fallback');assert.equal(failure.service.job,null);
 const invalid=setup(t,{stream:async function*(){yield {type:'text-delta',text:'记得去年我们一起参加过活动'};yield {type:'finish',reason:{kind:'stop'}}}});await invalid.generate();assert.equal(invalid.service.snapshot().source,'fallback');
 const cancelled=setup(t,{stream:async function*(options){await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));options.signal.throwIfAborted();}});cancelled.service.snapshot();clearTimeout(cancelled.service.job.timer);const pending=cancelled.service.generate();await new Promise(resolve=>setImmediate(resolve));cancelled.service.cancel();await pending;assert.equal(cancelled.service.snapshot().source,'fallback');
});
test('existing memories are read-only, bounded, exclude sensitive/forgotten/task entries, and mark learned observations tentative',t=>{
 const root=mkdtempSync(join(tmpdir(),'mochi-holiday-memory-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'mem.sqlite'),db=openStore(path),store=createStore(db);
 store.note({kind:'preference',content:'喜欢简洁表达',source:'observed'});const old=store.note({kind:'preference',content:'旧偏好',source:'explicit_request'});store.forget(old.id);store.note({kind:'task_fact',content:'完成过任务',source:'explicit_request'});db.prepare("INSERT INTO mochi_memories(kind,content,source,valid_at,created_at) VALUES('preference','password secret','user_statement','now','now')").run();
 const before=store.stats();const rows=readGreetingMemories(path);assert.deepEqual(rows.map(x=>x.text),['喜欢简洁表达']);assert.equal(rows[0].tentative,true);assert.deepEqual(store.stats(),before);db.close();
});

test('two service instances cannot race quota reservations, and unreadable memories never return old personalization',async t=>{
 let release;const h=setup(t,{stream:async function*(){await new Promise(r=>release=r);yield {type:'text-delta',text:'愿假期自在'};yield {type:'finish',reason:{kind:'stop'}};}});
 h.service.snapshot();clearTimeout(h.service.job.timer);const pending=h.service.generate();await new Promise(r=>setImmediate(r));
 let calls=0;const second=new HolidayGreeting({profile:h.profile,now:day,memories:()=>[],idle:()=>true,route:()=>({provider:'fixture',model:'known'}),stream:async function*(){calls++;},delayMs:100000});t.after(()=>second.close());second.snapshot();clearTimeout(second.job.timer);await second.generate();assert.equal(calls,0);release();await pending;assert.equal(second.snapshot().source,'model');
 second.memories=()=>{throw Error('unavailable')};assert.equal(second.snapshot().source,'fallback');assert.equal(second.job,null);
});


test('homepage greeting stays compact and rejects legacy long cache without truncating sentences',async t=>{
 const h=setup(t);await h.generate();assert.ok(Array.from(h.service.snapshot().greeting).length<=28);
 const cache=h.service.readCache();cache.entries[0].text='王老师，国庆节，愿'+ '每天开心'.repeat(12);h.service.save(cache);
 assert.equal(h.service.snapshot().source,'fallback');assert.match(h.service.snapshot().greeting,/国庆快乐/);
 const long=setup(t,{stream:async function*(){yield {type:'text-delta',text:'愿'+ '心情愉快'.repeat(6)};yield {type:'finish',reason:{kind:'stop'}};}});
 await long.generate();assert.equal(long.service.snapshot().source,'fallback');
 const address=setup(t,{address:'高一年级数学教研组王老师'});await address.generate();assert.equal(address.service.snapshot().source,'model');assert.ok(Array.from(address.service.snapshot().greeting).length<=28);
});

test('holiday wishes exclude work reminders from generation, personalization and existing cache',async t=>{
 const h=setup(t,{memories:()=>[{id:1,text:'备课喜欢先做课件'},{id:2,text:'喜欢安静散步'}]});
 await h.generate();
 const sent=JSON.stringify(h.calls[0].messages);
 assert.ok(!sent.includes('备课'));assert.ok(sent.includes('散步'));
 assert.match(h.calls[0].system,/不把节日祝福写成工作提醒/);
 const cache=h.service.readCache();cache.entries[0].text='国庆节，祝备课清晰，课堂顺利';h.service.save(cache);
 assert.equal(h.service.snapshot().source,'fallback');
 assert.equal(h.service.snapshot().greeting,'国庆快乐，愿你自在，心有晴光');
 const invalid=setup(t,{stream:async function*(){yield {type:'text-delta',text:'愿工作顺利，效率更高'};yield {type:'finish',reason:{kind:'stop'}};}});
 await invalid.generate();assert.equal(invalid.service.snapshot().source,'fallback');
});
