import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from './mem-store.mjs';
import { JournalStore } from './journal-store.mjs';
import { createJournalScheduler, JOURNAL_BATCH_SIZE } from './journal-scheduler.mjs';
import { createScheduleStore, openScheduleDb } from '../mochi-task-scheduler/store.mjs';

const ms=value=>Date.parse(value),wait=value=>new Promise(resolve=>setTimeout(resolve,value));
async function eventually(check){const deadline=Date.now()+2000;while(!check()){if(Date.now()>deadline)throw new Error('真实定时器未在有界等待内完成。');await wait(10);}}
function fixture(t,{time='2026-09-30T22:00:00+08:00',role='teacher',generate,tickMs=60000}={}){
  const root=mkdtempSync(join(tmpdir(),'mochi-journal-scheduler-')),path=join(root,'memory.sqlite'),db=openStore(path);
  let current=ms(time);const now=()=>current;
  const journal=new JournalStore(db,{role,now});let scheduler=createJournalScheduler(journal,{now,generate,tickMs});
  t.after(async()=>{await scheduler.close();db.close();rmSync(root,{recursive:true,force:true});});
  return{journal,db,path,now,scheduler,advance(value){current=ms(value);},async restart(){await scheduler.close();scheduler=createJournalScheduler(journal,{now,generate,tickMs});this.scheduler=scheduler;await scheduler.start();return scheduler;}};
}
const record=(journal,date,id=date)=>journal.recordActivity({id,kind:'task',at:ms(`${date}T10:00:00+08:00`),summary:`整理了${date}的练习材料。`,sourceIds:['session:'+id]});

test('关闭自动不生成；开关与时间修改调整真实持久任务',async t=>{
  const f=fixture(t);record(f.journal,'2026-09-30');f.journal.configure({expectedRevision:0,autoEnabled:false});
  await f.scheduler.start();assert.equal(f.scheduler.status().task,null);assert.equal(f.scheduler.status().pendingTimer,false);assert.equal(f.journal.list().length,0);
  await f.scheduler.configure({expectedRevision:1,autoEnabled:true,dailyTime:'23:00'});assert.equal(f.scheduler.status().task.time_of_day,'23:00');assert.equal(f.journal.list().length,0);
  await f.scheduler.configure({expectedRevision:2,dailyTime:'21:30'});await eventually(()=>f.journal.list().length===1);const task=f.scheduler.status().task;
  await f.scheduler.configure({expectedRevision:3,autoEnabled:false});assert.equal(f.scheduler.status().task,null);assert.equal(f.scheduler.status().pendingTimer,false);
  assert.equal(f.db.prepare('SELECT state FROM mochi_schedules WHERE id=?').get(task.id).state,'cancelled');
});

test('今天到时间才写，启动只补已有来源，空日不生成',async t=>{
  const f=fixture(t,{time:'2026-09-30T20:00:00+08:00'});record(f.journal,'2026-09-28');record(f.journal,'2026-09-30');
  await f.scheduler.start();assert.deepEqual(f.journal.list().map(row=>row.date),['2026-09-28']);
  f.advance('2026-09-30T21:30:00+08:00');await f.scheduler.tick();assert.deepEqual(f.journal.list().map(row=>row.date),['2026-09-30','2026-09-28']);
  assert.equal(f.journal.get('diary:2026-09-29'),null);assert.equal(f.journal.history().sourceEntryIds.length,2);
});

test('跨多日有界批次继续推进，重启不重复生成也不复制任务',async t=>{
  const f=fixture(t);for(let i=1;i<=17;i++)record(f.journal,`2026-09-${String(i).padStart(2,'0')}`);
  await f.scheduler.start();assert.equal(f.journal.list().length,JOURNAL_BATCH_SIZE);assert.equal(f.scheduler.status().pendingDates.length,10);
  await f.scheduler.tick();await f.scheduler.tick();assert.equal(f.journal.list().length,17);assert.equal(f.scheduler.status().pendingDates.length,0);
  const task=f.scheduler.status().task,id=task.id;await f.restart();assert.equal(f.journal.list().length,17);assert.equal(f.scheduler.status().task.id,id);
  assert.equal(f.journal.versions('diary:2026-09-01').length,0);
});

test('晚间新增来源于重启补齐，人工日记和人工历史始终保护',async t=>{
  const f=fixture(t);record(f.journal,'2026-09-29');record(f.journal,'2026-09-30');await f.scheduler.start();
  const old=f.journal.get('diary:2026-09-29');f.journal.edit({id:old.id,expectedRevision:old.revision,body:'人工保留的昨天。'});
  const history=f.journal.history();f.journal.editHistory({expectedRevision:history.revision,body:'人工写下的来时路。'});
  f.journal.recordActivity({id:'late',kind:'conversation',at:ms('2026-09-30T21:55:00+08:00'),summary:'一起检查了明天的课程安排。'});
  record(f.journal,'2026-09-29','older-extra');await f.restart();
  assert.match(f.journal.get('diary:2026-09-30').body,/一起检查/);assert.equal(f.journal.get(old.id).body,'人工保留的昨天。');assert.equal(f.journal.history().body,'人工写下的来时路。');
});

test('调度只查询当前角色日记，不消费大量其他到期任务',async t=>{
  const f=fixture(t),otherDb=openScheduleDb(f.path),other=createScheduleStore(otherDb);t.after(()=>otherDb.close());
  const foreign=[];for(let i=0;i<55;i++)foreign.push(other.createSchedule({title:'其他会话提醒',kind:'notify',frequency:'daily',timeOfDay:'20:00',timeZone:'Asia/Shanghai',nextRunAt:f.now()-100000,sessionId:'real-session',agentId:'real-agent'}));
  const classroom=new JournalStore(f.db,{role:'classroom',now:f.now}),classroomScheduler=createJournalScheduler(classroom,{now:f.now});t.after(()=>classroomScheduler.close());
  record(classroom,'2026-09-30');await classroomScheduler.start();const classroomTask=classroomScheduler.status().task;
  record(f.journal,'2026-09-30');await f.scheduler.start();assert.equal(f.journal.list().length,1);
  for(const row of foreign)assert.equal(other.getSchedule(row.id).run_count,0);
  assert.equal(other.getSchedule(classroomTask.id).run_count,1);assert.equal(other.listRuns(foreign[0].id).length,0);
});

test('失败持久退避，坏日期不堵住其他日期，实际定时器没有忙循环',async t=>{
  let attempts=0;const f=fixture(t,{tickMs:80,generate:day=>{attempts++;if(day==='2026-09-01')throw new Error('测试生成失败');return f.journal.generateDay(day);}});
  for(let i=1;i<=10;i++)record(f.journal,`2026-09-${String(i).padStart(2,'0')}`);
  await f.scheduler.start();assert.equal(f.journal.list().length,6);assert.equal(f.scheduler.status().failures.length,1);
  await f.scheduler.tick();assert.equal(f.journal.list().length,9);const before=attempts;
  await wait(260);assert.equal(attempts,before,'固定测试时间未跨重试时刻，不反复调用失败模型');
  assert.equal(f.scheduler.status().pendingDates.length,1);
  f.advance('2026-09-30T22:00:01+08:00');await f.scheduler.tick();assert.equal(attempts,before+1);
  const task=f.scheduler.status().task,runs=f.db.prepare('SELECT * FROM mochi_schedule_runs WHERE schedule_id=?').all(task.id);
  assert.equal(runs.length,1);assert.equal(runs[0].outcome,'failed');assert.match(runs[0].detail,/失败/);
});

test('取消正在等待的生成后不保存晚回包，close清除原调度定时器',async t=>{
  let begin,resolve;const began=new Promise(done=>begin=done),response=new Promise(done=>resolve=done);
  const f=fixture(t,{generate:async(_day,{signal})=>{begin(signal);return response;}});record(f.journal,'2026-09-30');
  const starting=f.scheduler.start(),signal=await began;await f.scheduler.close();await starting;assert.equal(signal.aborted,true);assert.equal(f.scheduler.status().pendingTimer,false);
  resolve({title:'晚回包',body:'不应保存。',sourceIds:['2026-09-30']});await wait(20);assert.equal(f.journal.list().length,0);
});

test('history只合并最近30个实际记录日，不删除早期日记',async t=>{
  const f=fixture(t);for(let day=1;day<=30;day++)record(f.journal,`2026-08-${String(day).padStart(2,'0')}`);record(f.journal,'2026-09-29');record(f.journal,'2026-09-30');
  await f.scheduler.start();for(let i=0;i<4;i++)await f.scheduler.tick();
  assert.equal(f.journal.list().length,32);assert.equal(f.journal.history().sourceEntryIds.length,30);assert.ok(!f.journal.history().sourceEntryIds.includes('diary:2026-08-01'));assert.equal(f.journal.get('diary:2026-08-01').date,'2026-08-01');
});

test('内存journal必须显式测试schedulePath；已有文件数据库直接复用',async t=>{
  const db=openStore(':memory:');t.after(()=>db.close());const journal=new JournalStore(db,{role:'teacher'});
  assert.throws(()=>createJournalScheduler(journal),/schedulePath/);
  const root=mkdtempSync(join(tmpdir(),'mochi-journal-memory-schedule-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const scheduler=createJournalScheduler(journal,{schedulePath:join(root,'schedule.sqlite')});await scheduler.start();await scheduler.close();
});

test('配置快速返回，现有真实timer启动等待模型，完成后才持久保存',async t=>{
  let begin,release,entered=false;const began=new Promise(done=>begin=done),reply=new Promise(done=>release=done);
  const f=fixture(t,{time:'2026-09-30T20:00:00+08:00',generate:async()=>{entered=true;begin();return reply;}});record(f.journal,'2026-09-30');
  await f.scheduler.start();const started=performance.now();
  await f.scheduler.configure({expectedRevision:0,dailyTime:'19:30'});
  assert.ok(performance.now()-started<200,'设置保存不等待模型首批生成');
  await eventually(()=>entered);await began;assert.equal(f.journal.list().length,0);
  release({body:'根据真实活动形成的模型摘要。',sourceIds:['2026-09-30']});
  await eventually(()=>f.journal.list().length===1);assert.equal(f.journal.list()[0].generator,'model');
});

test('应用运行中真实timer到日记时间生成，无需手动tick',async t=>{
  const f=fixture(t,{time:'2026-09-30T21:29:00+08:00',tickMs:40});record(f.journal,'2026-09-30');await f.scheduler.start();
  assert.equal(f.journal.list().length,0);f.advance('2026-09-30T21:30:00+08:00');
  await eventually(()=>f.journal.list().length===1);assert.equal(f.scheduler.status().task.run_count,1);assert.equal(f.journal.history().sourceEntryIds.length,1);
});
