import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shanghaiDay,journalMethod,schedulingText,diarySavePayload,historyPreviewPayload} from './journal-view.mjs';
test('date and generation labels remain truthful',()=>{
  assert.equal(shanghaiDay(Date.parse('2026-09-30T16:00:00Z')),'2026-10-01');
  assert.match(journalMethod({generator:'local'}),/本机活动摘录/);
  assert.match(journalMethod({generator:'model',edited:true}),/由模型.*已由你修改/);
  assert.equal(journalMethod({}),'整理方式未注明');
});
test('scheduled time is claimed only from an actual running scheduled task',()=>{
  assert.match(schedulingText({settings:{autoEnabled:true,dailyTime:'21:30'}}),/状态尚未确认/);
  assert.match(schedulingText({settings:{autoEnabled:false}}),/已关闭/);
  const actual=schedulingText({settings:{autoEnabled:true},scheduling:{started:true,closed:false,task:{state:'scheduled',next_run_at:'2026-09-30T13:30:00Z'},pendingDates:['2026-09-29'],failures:[{date:'2026-09-28'}]}});
  assert.match(actual,/21:30/);assert.match(actual,/1 个活动日待补记/);assert.match(actual,/1 项整理失败/);
});
test('long edits keep original revision and text; empty history cannot invent sources',()=>{
  const body='第一段\n\n原样的长信。'.repeat(500);
  assert.deepEqual(diarySavePayload({id:'diary:2026-09-30',revision:4},{title:'新信名',body}),{id:'diary:2026-09-30',expectedRevision:4,title:'新信名',body});
  assert.throws(()=>historyPreviewPayload({empty:true,sourceEntryIds:[]},'历史'),/没有已有日记/);
  const sourceEntryIds=['diary:2026-09-30'];
  const value=historyPreviewPayload({historyRevision:8,body,sourceEntryIds,empty:false},'相处册');
  sourceEntryIds.push('later');assert.deepEqual(value.sourceEntryIds,['diary:2026-09-30']);assert.equal(value.expectedRevision,8);assert.equal(value.body,body);
});
