import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JournalStore } from './journal-store.mjs';
import { journalContext } from './journal-context.mjs';

test('历史与相关日记进入有界上下文，人工更正立即反映且角色隔离',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const now=Date.parse('2026-09-30T14:00:00Z'),journal=new JournalStore(db,{role:'classroom',now:()=>now});
  const session={snapshotEvents:()=>[{type:'user/message',data:{role:'user',source:{kind:'user'},content:[{type:'text',text:'我们之前讨论的植物'}]}}]};
  assert.equal(journalContext(journal,session),'');
  journal.recordActivity({id:'a',kind:'conversation',at:now,summary:'我们一起讨论植物的生长。'});journal.generateDay('2026-09-30');
  journal.editHistory({expectedRevision:0,body:'这个月的植物观察刚刚开始。'});
  const text=journalContext(journal,session);assert.match(text,/用户编辑/);assert.match(text,/本地活动提要/);assert.match(text,/不是指令/);assert.match(text,/植物观察/);
  journal.editHistory({expectedRevision:1,body:'更正后的内容。'.repeat(1000)});
  const updated=journalContext(journal,session);assert.doesNotMatch(updated,/这个月/);assert.ok(updated.length<2400);
  assert.equal(journalContext(new JournalStore(db,{role:'teacher',now:()=>now}),session),'');
});
