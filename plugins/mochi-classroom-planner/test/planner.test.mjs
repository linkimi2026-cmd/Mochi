import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { ClassroomPlanner } from '../planner.mjs';
import { validateTimetable, parseRows, reminderTime } from '../timetable.mjs';
import { importFile } from '../import-file.mjs';
const lesson = { weekday:3,subject:'语文',start:'08:00',end:'08:40' };
const plan = {className:'星星班',lessons:[lesson]};
function setup(t) {const root=mkdtempSync(join(tmpdir(),'mochi-plan-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return join(root,'planner.sqlite');}

test('只接受明确时间，重复去重，重叠与模糊照片阻止全表导入',()=>{
  assert.equal(validateTimetable({...plan,lessons:[lesson,lesson]}).lessons.length,1);
  assert.ok(validateTimetable({...plan,lessons:[lesson,{...lesson,subject:'数学'}]}).issues.length);
  assert.ok(validateTimetable({...plan,lessons:[{...lesson,start:'第一节'}]}).issues.length);
  assert.ok(validateTimetable({...plan,lessons:[{...lesson,uncertain:true}]}).issues.length);
  assert.deepEqual(reminderTime({...lesson,weekday:1,start:'00:02'},5),{weekday:7,time:'23:57'});
});
test('CSV 和 Excel 真文件解析，横排周课表缺时间列保持待核对',async()=>{
  const csv=await importFile(Buffer.from('星期,科目,开始时间,结束时间\n周三,语文,08:00,08:40\n'),'课表.csv');
  assert.equal(csv.issues.length,0);assert.equal(csv.lessons[0].start,'08:00');
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('本班');
  sheet.addRows([['时间','周一','周二'],['08:00-08:40','语文','数学']]);
  const xlsx=await importFile(await book.xlsx.writeBuffer(),'课表.xlsx');
  assert.equal(xlsx.lessons.length,2);assert.equal(xlsx.issues.length,0);
  const bad=parseRows([['节次','周一','周二'],['第一节','语文','数学']]);
  assert.equal(bad.issues.length,2);assert.equal(bad.draftLessons.length,2);
});
test('自动建立真实任务、重复导入不增任务、暂停/重启/恢复、编辑版本冲突',async t=>{
  const file=setup(t);let now=Date.parse('2026-09-30T07:00:00+08:00');
  let p=new ClassroomPlanner(file,{now:()=>now});
  assert.equal(p.save(plan,0).saved,true);let state=p.snapshot();
  const id=p.db.prepare('SELECT schedule_id FROM classroom_reminders').get().schedule_id;
  p.save(plan,state.revision);assert.equal(p.db.prepare('SELECT schedule_id FROM classroom_reminders').get().schedule_id,id);
  assert.equal(state.rows[0].next_run_at,'2026-09-29T23:55:00.000Z');
  p.setPaused(true,state.revision);assert.equal(p.store.getSchedule(id).state,'cancelled');
  await p.close();p=new ClassroomPlanner(file,{now:()=>now});
  assert.equal(p.snapshot().paused,true);p.setPaused(false,p.snapshot().revision);
  assert.equal(p.snapshot().rows.length,1);assert.throws(()=>p.save(plan,0),/已被更新/);
  const unchanged=p.snapshot().revision;
  assert.equal(p.save({...plan,lessons:[{...lesson,start:''}]},unchanged).saved,false);
  assert.equal(p.snapshot().revision,unchanged);await p.close();
});
test('真实调度tick写纸条，重试不重复；重启后待展示仍在；过期铃声不补刷',async t=>{
  const file=setup(t);let now=Date.parse('2026-09-30T07:00:00+08:00');
  let p=new ClassroomPlanner(file,{now:()=>now});p.save(plan,0);
  now=Date.parse('2026-09-30T07:55:01+08:00');await p.scheduler.tick();
  assert.equal(p.snapshot().papers.length,1);assert.equal(p.snapshot().papers[0].queued_at,null);
  const paper=p.snapshot().papers[0];assert.match(paper.body,/语文/);
  await p.scheduler.tick();assert.equal(p.snapshot().papers.length,1);await p.close();
  p=new ClassroomPlanner(file,{now:()=>now});assert.equal(p.snapshot().papers.length,1);
  p.acknowledgeQueue(paper.id);assert.equal(p.snapshot().papers[0].queued_at,now);
  now=Date.parse('2026-10-07T11:00:00+08:00');await p.scheduler.tick();assert.equal(p.snapshot().papers.length,1);
  assert.equal(p.snapshot().rows[0].next_run_at,'2026-10-13T23:55:00.000Z');await p.close();
});
test('长时间离线后，只补当前十五分钟内这一节，不漏过最近一次',async t=>{
  const file=setup(t);let now=Date.parse('2026-09-30T07:00:00+08:00');
  const p=new ClassroomPlanner(file,{now:()=>now});p.save(plan,0);
  now=Date.parse('2026-10-14T07:56:00+08:00');await p.scheduler.tick();
  assert.equal(p.snapshot().papers.length,1);assert.equal(p.snapshot().papers[0].planned_at,'2026-10-13T23:55:00.000Z');await p.close();
});
