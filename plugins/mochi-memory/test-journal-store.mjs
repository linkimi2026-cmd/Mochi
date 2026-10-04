import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, openStore } from './mem-store.mjs';
import { JournalStore, JOURNAL_LIMITS, journalDate } from './journal-store.mjs';

const at=value=>Date.parse(value);
const instant=at('2026-09-30T22:00:00+08:00');
function fixture(t,role='teacher'){
  const root=mkdtempSync(join(tmpdir(),'mochi-journal-')),path=join(root,'memory.sqlite'),memory=createStore(openStore(path));
  let db=memory.db;
  t.after(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  const journal=new JournalStore(db,{role,now:()=>instant});
  return{journal,db,path,reopen(){db.close();db=openStore(path);return new JournalStore(db,{role,now:()=>instant});}};
}
const activity=(id='task-1',date='2026-09-30')=>({id,kind:'task',at:at(`${date}T10:00:00+08:00`),summary:'整理了分数练习材料。',sourceIds:['session-1:message-1']});
const code=value=>error=>error.code===value;

test('无活动不写日记，不创建补记，默认历史为空',t=>{
  const{journal}=fixture(t);
  assert.equal(journal.generateDay('2026-09-30'),null);
  assert.equal(journal.generateDay('2026-09-29'),null);
  assert.deepEqual(journal.list(),[]);assert.equal(journal.history().body,'');
  assert.equal(journal.summarizeRange({from:'2026-09-01',to:'2026-09-30'}).empty,true);
});

test('活动稳定id幂等，原句及上游来源保留，一日一篇跨重启幂等',t=>{
  const f=fixture(t),input=activity();
  assert.deepEqual(f.journal.recordActivity(input),f.journal.recordActivity(input));
  assert.throws(()=>f.journal.recordActivity({...input,summary:'另一项任务。'}),code('JOURNAL_ACTIVITY_CONFLICT'));
  const entry=f.journal.generateDay('2026-09-30');
  assert.equal(entry.generator,'local');assert.equal(entry.revision,0);assert.match(entry.body,/整理了分数练习材料/);
  assert.deepEqual(entry.sourceIds,['task-1']);assert.deepEqual(entry.sources[0].sourceIds,input.sourceIds);
  const reopened=f.reopen();assert.deepEqual(reopened.generateDay('2026-09-30'),entry);assert.equal(reopened.list().length,1);
});

test('上海日期跨UTC日界，跨日只使用本日来源',t=>{
  const{journal}=fixture(t);
  assert.equal(journalDate(at('2026-09-29T16:10:00Z')),'2026-09-30');
  journal.recordActivity({...activity('late'),at:at('2026-09-29T16:10:00Z')});
  journal.recordActivity(activity('previous','2026-09-29'));
  assert.deepEqual(journal.generateDay('2026-09-30').sourceIds,['late']);
  assert.deepEqual(journal.generateDay('2026-09-29').sourceIds,['previous']);
});

test('教师与课堂不同db隔离，同db传入角色也不互读',t=>{
  const teacher=fixture(t).journal,classroom=fixture(t,'classroom').journal;
  teacher.recordActivity(activity());assert.equal(classroom.generateDay('2026-09-30'),null);
  assert.equal(classroom.get('diary:2026-09-30'),null);
  const f=fixture(t),other=new JournalStore(f.db,{role:'classroom',now:()=>instant});
  f.journal.recordActivity(activity());other.recordActivity({...activity(),summary:'完成了本班课堂记录。',kind:'classroom'});
  assert.notEqual(f.journal.generateDay('2026-09-30').body,other.generateDay('2026-09-30').body);
});

test('日记人工长文与改名保留版本，陈旧保存拒绝，自动和模型均不能覆盖',t=>{
  const{journal}=fixture(t);journal.recordActivity(activity());const before=journal.generateDay('2026-09-30');
  const body='保留的课堂感受。'.repeat(900);
  const edited=journal.edit({id:before.id,expectedRevision:0,title:'我的分数课堂',body});
  assert.equal(edited.edited,true);assert.equal(edited.body,body);assert.deepEqual(edited.sources,before.sources);
  assert.equal(journal.versions(before.id)[0].body,before.body);
  assert.throws(()=>journal.edit({id:before.id,expectedRevision:0,body:'陈旧正文'}),code('JOURNAL_REVISION_CONFLICT'));
  assert.deepEqual(journal.generateDay('2026-09-30'),edited);
  assert.deepEqual(journal.saveGeneratedDay({date:'2026-09-30',body:'模型新摘要。',sourceIds:['task-1']}),{protected:true,entry:edited});
});

test('模型日记只能引用本日已有活动，生成不冒称本地深度总结',t=>{
  const{journal}=fixture(t);
  assert.throws(()=>journal.saveGeneratedDay({date:'2026-09-30',body:'没有依据',sourceIds:['invented']}),code('JOURNAL_SOURCE_REQUIRED'));
  journal.recordActivity(activity('old','2026-09-29'));journal.recordActivity(activity());
  for(const sourceIds of [[],['old'],['task-1','task-1'],['invented']])assert.throws(()=>journal.saveGeneratedDay({date:'2026-09-30',body:'摘要',sourceIds}));
  const local=journal.generateDay('2026-09-30');
  const model=journal.saveGeneratedDay({date:'2026-09-30',title:'有来源的摘要',body:'完成了分数练习材料整理。',sourceIds:['task-1']});
  assert.equal(model.generator,'model');assert.equal(model.id,local.id);assert.equal(model.revision,1);assert.equal(journal.list().length,1);
  assert.equal(journal.versions(model.id)[0].generator,'local');
  assert.deepEqual(journal.saveGeneratedDay({date:model.date,title:model.title,body:model.body,sourceIds:model.sourceIds}),model);
});

test('设置改名时间与revision持久，非法时间或敏感内容原子拒绝',t=>{
  const f=fixture(t),settings=f.journal.configure({expectedRevision:0,diaryName:'小猫日记',historyName:'我们的来时路',dailyTime:'20:15',autoEnabled:false});
  assert.equal(settings.revision,1);const reopened=f.reopen();assert.equal(reopened.settings().dailyTime,'20:15');
  assert.throws(()=>reopened.configure({expectedRevision:0,dailyTime:'20:30'}),code('JOURNAL_REVISION_CONFLICT'));
  for(const dailyTime of ['24:00','9:30','12:60'])assert.throws(()=>reopened.configure({expectedRevision:1,dailyTime}));
  assert.equal(reopened.settings().revision,1);
});

test('长历史人工改名、自动保护、显式来源预览保存与旧版本',t=>{
  const{journal}=fixture(t);for(const day of ['2026-09-28','2026-09-30']){journal.recordActivity(activity(day,day));journal.generateDay(day);}
  const preview=journal.summarizeRange({from:'2026-09-28',to:'2026-09-30'});
  assert.equal(preview.method,'local-merge');assert.equal(preview.sourceEntryIds.length,2);assert.equal(journal.history().revision,0);
  const generated=journal.saveGeneratedHistory({expectedRevision:0,body:preview.body,sourceEntryIds:preview.sourceEntryIds});
  assert.equal(generated.edited,false);assert.deepEqual(generated.sourceEntryIds,preview.sourceEntryIds);
  const body='一路陪伴的真实记录。'.repeat(1800);
  const edited=journal.editHistory({expectedRevision:1,title:'我们一起走过',body});assert.equal(edited.body,body);assert.equal(edited.edited,true);
  assert.deepEqual(journal.saveGeneratedHistory({expectedRevision:2,body:'新摘要',sourceEntryIds:preview.sourceEntryIds}),{protected:true,history:edited});
  assert.equal(journal.versions('history')[0].body,generated.body);
  const saved=journal.editHistory({expectedRevision:2,body:preview.body,sourceEntryIds:preview.sourceEntryIds});assert.equal(saved.revision,3);assert.equal(saved.edited,true);
  assert.throws(()=>journal.saveGeneratedHistory({expectedRevision:2,body:'旧请求',sourceEntryIds:preview.sourceEntryIds}),code('JOURNAL_REVISION_CONFLICT'));
});

test('越界、敏感正文、未来和非法日期、伪造历史来源均拒绝',t=>{
  const{journal}=fixture(t);
  for(const input of [{...activity(),summary:'我的密码是 abc'},{...activity(),summary:'字'.repeat(2001)},{...activity(),at:instant+1},{...activity(),kind:'fake'}])assert.throws(()=>journal.recordActivity(input));
  for(const day of ['2026-02-29','2026-09-31','2026-10-01','2026-9-30'])assert.throws(()=>journal.generateDay(day));
  assert.throws(()=>journal.summarizeRange({from:'2026-09-30',to:'2026-09-01'}));
  journal.recordActivity(activity());const entry=journal.generateDay('2026-09-30');
  for(const body of ['字'.repeat(12001),'password abc'])assert.throws(()=>journal.edit({id:entry.id,expectedRevision:0,body}));
  assert.equal(journal.get(entry.id).revision,0);
  assert.throws(()=>journal.editHistory({expectedRevision:0,body:'字'.repeat(24001)}));
  for(const sourceEntryIds of [[],['invented']])assert.throws(()=>journal.saveGeneratedHistory({expectedRevision:0,body:'摘要',sourceEntryIds}),code('JOURNAL_SOURCE_REQUIRED'));
});

test('合并预览有界且带准确entry来源与revision，保留长篇全文',t=>{
  const{journal}=fixture(t);
  for(let day=1;day<=30;day++){
    const date=`2026-09-${String(day).padStart(2,'0')}`,id='source-'+day;
    journal.recordActivity(activity(id,date));journal.saveGeneratedDay({date,title:'题'.repeat(120),body:'长正文'.repeat(4000),sourceIds:[id]});
  }
  const preview=journal.summarizeRange({from:'2026-09-01',to:'2026-09-30'});
  assert.equal(preview.sourceEntryIds.length,30);assert.ok(preview.body.length<=JOURNAL_LIMITS.historyBody);assert.ok(preview.sources.every(row=>row.truncated&&row.revision===0));
  assert.equal(journal.get(preview.sourceEntryIds[0]).body.length,12000);assert.equal(journal.history().body,'');
});

test('记录日期只列真实活动，晚间新增活动更新未编辑篇并保留旧版',t=>{
  const{journal}=fixture(t);assert.deepEqual(journal.recordedDates(),[]);
  journal.recordActivity(activity('old','2026-09-28'));journal.recordActivity(activity());
  const first=journal.generateDay('2026-09-30');
  journal.recordActivity({...activity('late'),at:at('2026-09-30T21:45:00+08:00'),summary:'晚间完成了教案检查。'});
  const updated=journal.generateDay('2026-09-30');assert.equal(updated.id,first.id);assert.equal(updated.revision,1);
  assert.match(updated.body,/晚间完成了教案检查/);assert.deepEqual(updated.sourceIds,['task-1','late']);
  assert.deepEqual(journal.versions(first.id)[0].sourceIds,['task-1']);
  assert.deepEqual(journal.generateDay('2026-09-30'),updated);assert.deepEqual(journal.recordedDates(),['2026-09-28','2026-09-30']);
  const manual=journal.edit({id:first.id,expectedRevision:1,body:'人工保留的日记。'});
  journal.recordActivity({...activity('later'),at:at('2026-09-30T21:55:00+08:00')});
  assert.deepEqual(journal.generateDay('2026-09-30'),manual);
});

test('长活动达到日字符上限后拒绝新增，不丢来源；模板过长不假装已总结',t=>{
  const{journal}=fixture(t);
  for(let i=0;i<120;i++)journal.recordActivity({...activity('record-'+i),summary:'已核实的任务记录。'.repeat(300).slice(0,2000)});
  assert.equal(journal.daySources('2026-09-30').reduce((sum,row)=>sum+row.summary.length,0),240000);
  assert.throws(()=>journal.recordActivity(activity('over-limit')),code('JOURNAL_LIMIT_REACHED'));
  assert.equal(journal.daySources('2026-09-30').length,120);
  assert.throws(()=>journal.generateDay('2026-09-30'),code('JOURNAL_LIMIT_REACHED'));
  assert.equal(journal.list().length,0);
  const sources=journal.daySources('2026-09-30').map(row=>row.id);
  const saved=journal.saveGeneratedDay({date:'2026-09-30',body:'根据已有任务活动形成的有界摘要。',sourceIds:sources});
  assert.equal(saved.sources.length,120);assert.equal(saved.generator,'model');
});
