import assert from 'node:assert/strict';
import test from 'node:test';
import { holidayGreeting, installHolidayGreeting } from '../src/holiday-greeting.mjs';

test('solar and lunar festivals use local dates; ordinary days and leap months stay ordinary', () => {
  for (const [y,m,d,expected] of [[2026,2,16,'除夕'],[2026,2,17,'新年好'],[2027,2,6,'新年好'],[2026,6,19,'端午安康'],[2026,9,25,'中秋快乐'],[2026,9,10,'教师节快乐'],[2026,10,1,'国庆快乐'],[2026,1,1,'新年好'],[2026,4,5,'清明时节']]) {
    assert.ok(holidayGreeting(new Date(y,m-1,d,12)).startsWith(expected), `${y}-${m}-${d}`);
  }
  assert.equal(holidayGreeting(new Date(2026,8,27)), '你好，我是 Mochi');
  assert.equal(holidayGreeting(new Date(NaN)), '你好，我是 Mochi');
});

test('greeting registers once per value, wakes at midnight, and removes timers/listeners on disposal', () => {
  const events = new Map(); let wake; let registered = 0; let released = 0; let delay;
  const target = { addEventListener: (name, fn) => events.set(name,fn), removeEventListener: name => events.delete(name) };
  const environment = { ...target, document: target, setTimeout: (fn, ms) => { wake=fn;delay=ms;return 1; }, clearTimeout: () => {wake=undefined;} };
  const dispose = installHolidayGreeting({ register: () => { registered++;return () => released++; } }, {}, environment);
  assert.equal(registered,1); assert.ok(delay > 0 && delay <= 86400100);
  events.get('focus')(); events.get('visibilitychange')(); assert.equal(registered,1);
  dispose(); assert.equal(events.size,0); assert.equal(wake,undefined); assert.equal(released,1);
});

test('home switching, profile updates and forgetting clear old personalization; stale inflight results cannot restore it', async () => {
  const events=new Map(),timers=new Map(),headlines=[];let seq=0,home=true,notifyHome,resolve;
  const target={addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
  const response=greeting=>({ok:true,json:async()=>({greeting,status:'ready'})});
  let fetcher=async()=>response('测试老师，愿假期愉快');let count=0;
  const env={...target,document:target,navigator:{onLine:true},setTimeout:(fn)=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),fetch:(...args)=>{count++;return fetcher(...args);}};
  const dispose=installHolidayGreeting({register:(_a,_b,d)=>{headlines.push(d['hero.headline']);return()=>{};}},{},env,{isHome:()=>home,subscribe:fn=>{notifyHome=fn;return()=>notifyHome=null;}});
  const flush=()=>new Promise(r=>setImmediate(r));await flush();assert.equal(headlines.at(-1),'测试老师，愿假期愉快');
  fetcher=()=>new Promise(r=>resolve=r);events.get('mochi-user-profile-updated')();assert.equal(headlines.at(-1),holidayGreeting());
  events.get('mochi-memory-updated')();resolve(response('旧姓名与旧偏好'));await flush();assert.notEqual(headlines.at(-1),'旧姓名与旧偏好');
  home=false;notifyHome();resolve(response('离开后晚到结果'));await flush();assert.notEqual(headlines.at(-1),'离开后晚到结果');const before=count;
  events.get('mochi-memory-updated')();await flush();assert.equal(count,before);
  fetcher=async()=>response('新老师，愿生活自在');home=true;notifyHome();await flush();assert.equal(headlines.at(-1),'新老师，愿生活自在');dispose();assert.equal(events.size,0);assert.equal(timers.size,0);assert.equal(notifyHome,null);
});

test('public mounted and current-session stores invalidate even when session roster is unchanged', async () => {
  const {subscribeHolidayHome}=await import('../src/holiday-greeting.mjs');
  const store=initial=>{let value=initial;const callbacks=new Set();return {getSnapshot:()=>value,subscribe:fn=>{callbacks.add(fn);return()=>callbacks.delete(fn);},set:next=>{value=next;callbacks.forEach(fn=>fn());},size:()=>callbacks.size};};
  const list=store({current:'old'}),mounted=store('old'),old=store({blank:false}),fresh=store({blank:true});let count=0;
  const dispose=subscribeHolidayHome({sidebarRight:{mounted},sessions:{list,binding:id=>({session:id==='old'?old:fresh})}},()=>count++);
  assert.equal(old.size(),1);mounted.set('new');assert.equal(count,2);assert.equal(old.size(),0);assert.equal(fresh.size(),1);fresh.set({blank:false,running:true});assert.equal(count,3);mounted.set(undefined);assert.equal(fresh.size(),0);dispose();assert.equal(list.size()+mounted.size()+old.size()+fresh.size(),0);
});

test('homepage rejects old backend work-themed greetings instead of replacing its warm fallback',async()=>{
 const headlines=[];const noop=()=>{};
 const target={addEventListener:noop,removeEventListener:noop};
 const environment={...target,document:target,navigator:{onLine:true},setTimeout:()=>1,clearTimeout:noop,
   fetch:async()=>({ok:true,json:async()=>({greeting:'国庆节，祝备课清晰，课堂顺利',status:'ready'})})};
 const dispose=installHolidayGreeting({register:(_a,_b,d)=>{headlines.push(d['hero.headline']);return noop;}},{},environment,{isHome:()=>true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(headlines,[holidayGreeting()]);dispose();
});
