import test from 'node:test';
import assert from 'node:assert/strict';
import { completedReplies, ReplyReader } from '../reply-reader.mjs';

function turn(number, startSeq, {source={kind:'user'}, reason='completed', interrupted=false}={}) {
  return [
    {type:'turn/start',data:{turn:number}},
    {type:'user/message',data:{source,content:[{type:'text',text:'问题'}]}},
    {type:'assistant/message',data:{turn:number,interrupted,message:{content:[{type:'text',text:'**你好**。\n```js\nsecret\n```'}]}}},
    {type:'turn/end',data:{turn:number,reason:{kind:reason}}},
  ].map((event,index)=>({type:'event',event:{...event,seq:startSeq+index}}));
}
function fixture(entries=[]) {
  const listeners=new Set();let snapshot={entries,change:{kind:'replace'}};
  const calls=[],stops=[];
  const binding={eventSource:{getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},
    session:new Proxy({}, {get(){throw Error('Output cannot access prompt or microphone');}})};
  const desktop={speak:request=>{calls.push(request);return new Promise(()=>{});},stop:request=>{stops.push(request);return {ok:true};}};
  const reader=new ReplyReader(desktop);reader.bind(binding);
  return {reader,binding,calls,stops,listeners,push(next,kind='append'){snapshot={entries:next,change:{kind}};for(const fn of listeners)fn();}};
}
test('only completed human answers are spoken; legacy absent source is human, system sources are silent',()=>{
  assert.equal(completedReplies(turn(1,0),-1)[0].text,'你好。');
  assert.equal(completedReplies(turn(1,0,{source:null}),-1).length,1);
  for(const source of [{kind:'system-prompt'},{kind:'scheduled'},{kind:'tool'}])assert.deepEqual(completedReplies(turn(1,0,{source}),-1),[]);
  for(const reason of ['cancelled','failed'])assert.deepEqual(completedReplies(turn(1,0,{reason}),-1),[]);
  assert.deepEqual(completedReplies(turn(1,0,{interrupted:true}),-1),[]);
});
test('enabling is silent, no historical replay, new completed turn once, mute immediately stops',()=>{
  const history=turn(1,0),f=fixture(history);f.reader.setEnabled(true);
  assert.equal(f.calls.length,0);f.push(history,'replace');f.push(history,'prepend');assert.equal(f.calls.length,0);
  const next=[...history,...turn(2,4)];f.push(next);f.push(next);assert.equal(f.calls.length,1);
  f.reader.setEnabled(false);assert.equal(f.stops.length,1);
  f.push([...next,...turn(3,8)]);assert.equal(f.calls.length,1);
  f.reader.setEnabled(true);assert.equal(f.calls.length,1);f.reader.close();assert.equal(f.listeners.size,0);
});
test('binding a different session does not read its history and unmount cancels current output',()=>{
  const f=fixture();f.reader.setEnabled(true);f.push(turn(1,0));assert.equal(f.calls.length,1);
  const other=fixture(turn(9,0));other.reader.close();f.reader.bind(other.binding);assert.equal(f.stops.length,1);assert.equal(f.listeners.size,0);
  assert.equal(f.calls.length,1);other.push([...turn(9,0),...turn(10,4)]);assert.equal(f.calls.length,2);
  f.reader.close();assert.equal(f.stops.length,2);assert.equal(other.listeners.size,0);
});
