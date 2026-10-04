import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JournalStore } from './journal-store.mjs';
import { JournalWriter } from './journal-writer.mjs';

const setup = (t, stream) => {
  const db = new DatabaseSync(':memory:'); t.after(()=>db.close());
  const journal = new JournalStore(db,{role:'classroom',now:()=>Date.parse('2026-09-30T14:00:00Z')});
  const writer = new JournalWriter(journal,{stream});
  journal.recordActivity({id:'activity',at:Date.parse('2026-09-30T10:00:00Z'),kind:'conversation',summary:'大家一起讨论植物需要阳光。'});
  writer.observeRoute({snapshotEvents:()=>[{type:'assistant/message',data:{turn:1,message:{source:{provider:'fixture',model:'example'}}}}]}, {type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
  return {journal,writer};
};
test('日记复用真实路由单次生成，带来源并保护人工改写',async t=>{
  let calls=0;
  const {journal,writer}=setup(t,async function*(options){calls++;assert.equal(options.provider,'fixture');assert.deepEqual(options.tools,[]);assert.match(options.system,/整个班级/);assert.match(options.messages[0].content[0].text,/阳光/);yield{type:'text-delta',text:'今天，我和大家一起聊了植物为什么需要阳光。'};yield{type:'finish',reason:{kind:'stop'}};});
  const result=await writer.generate('2026-09-30');assert.equal(result.generator,'model');assert.deepEqual(result.sourceIds,['activity']);
  await writer.generate('2026-09-30');assert.equal(calls,1);
  journal.edit({id:result.id,expectedRevision:result.revision,body:'我想保留的版本。'});
  await writer.generate('2026-09-30');assert.equal(calls,1);assert.equal(journal.get(result.id).body,'我想保留的版本。');
  assert.equal(await writer.generate('2026-09-29'),null);
});
test('模型失败回落到有出处本地提要，显式取消不写入',async t=>{
  const {journal,writer}=setup(t,async function*(){yield{type:'text-delta',text:'没有完整结束的内容'};yield{type:'finish',reason:{kind:'error'}};});
  const controller=new AbortController();controller.abort();assert.equal(await writer.generate('2026-09-30',{signal:controller.signal}),null);assert.equal(journal.list().length,0);
  const result=await writer.generate('2026-09-30');assert.equal(result.generator,'local');assert.match(result.body,/阳光/);assert.doesNotMatch(result.body,/没有完整结束/);
});
