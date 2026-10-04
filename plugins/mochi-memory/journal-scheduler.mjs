import { openScheduleDb, createScheduleStore } from '../mochi-task-scheduler/store.mjs';
import { createScheduler } from '../mochi-task-scheduler/scheduler.mjs';
import { nextOccurrence, zonedParts } from '../mochi-task-scheduler/schedule-time.mjs';
import { journalDate } from './journal-store.mjs';
import { isSensitiveMemoryText } from './mem-store.mjs';

export const JOURNAL_BATCH_SIZE=7;
const zone='Asia/Shanghai',ownerAgent='mochi-journal-daily-v1';
const abortError=()=>Object.assign(new Error('日记生成已取消。'),{name:'AbortError'});
function cancellable(work,signal){
  if(signal.aborted)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(abortError());};
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(work).then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(abortError()):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

/** Reuses the persisted scheduler; no second polling timer or network client. */
export function createJournalScheduler(journal,{now=Date.now,tickMs=60000,generate=day=>journal.generateDay(day),schedulePath}={}){
  if(typeof generate!=='function'||typeof now!=='function'||!Number.isFinite(tickMs)||tickMs<25)throw new TypeError('需要有效日记生成接口与至少25ms的重试间隔。');
  const path=schedulePath??journal.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
  if(!path)throw new TypeError('内存SQLite测试需显式提供schedulePath；正式使用同一memory数据库文件。');
  const db=openScheduleDb(path),base=createScheduleStore(db),owner=`mochi-journal:${journal.role}`;
  journal.db.exec(`CREATE TABLE IF NOT EXISTS mochi_journal_generation_attempts(role TEXT NOT NULL,date TEXT NOT NULL,retry_at INTEGER NOT NULL,error TEXT NOT NULL,PRIMARY KEY(role,date));`);
  let started=false,closed=false,active=null,startPromise=null;
  const ownRows=()=>db.prepare('SELECT * FROM mochi_schedules WHERE session_id=? AND agent_id=? AND state=\'scheduled\' ORDER BY id').all(owner,ownerAgent);
  const owns=id=>{const row=base.getSchedule(id);return row?.session_id===owner&&row?.agent_id===ownerAgent?row:null;};
  const scoped={
    dueSchedules:at=>db.prepare('SELECT * FROM mochi_schedules WHERE session_id=? AND agent_id=? AND state=\'scheduled\' AND next_run_at<=? ORDER BY next_run_at,id LIMIT 1').all(owner,ownerAgent,new Date(at).toISOString()),
    nextWakeAt:()=>db.prepare('SELECT MIN(next_run_at) AS at FROM mochi_schedules WHERE session_id=? AND agent_id=? AND state=\'scheduled\'').get(owner,ownerAgent).at??null,
    getSchedule:owns,
    recordAttempt:input=>{if(!owns(input.scheduleId))throw new Error('日记调度不能记录其他任务。');return base.recordAttempt(input);},
    recordDelivered:input=>{if(!owns(input.scheduleId))throw new Error('日记调度不能推进其他任务。');return base.recordDelivered(input);},
    cancelSchedule:id=>{if(!owns(id))throw new Error('日记调度不能取消其他任务。');return base.cancelSchedule(id);},
  };
  function eligibleDates(){
    if(!journal.settings().autoEnabled)return[];
    const current=now(),today=journalDate(current),parts=zonedParts(current,zone),clock=`${String(parts.hour).padStart(2,'0')}:${String(parts.minute).padStart(2,'0')}`;
    const entries=new Map(journal.list().map(entry=>[entry.date,entry]));
    return journal.recordedDates().filter(day=>{
      if(day>today||(day===today&&clock<journal.settings().dailyTime))return false;
      const entry=entries.get(day);if(entry?.edited)return false;
      return !entry||journal.daySources(day).some(source=>!entry.sourceIds.includes(source.id));
    });
  }
  function refreshHistory(){
    const history=journal.history();if(history.edited)return history;
    const entries=journal.list().slice(0,30);if(!entries.length)return history;
    const preview=journal.summarizeRange({from:entries.at(-1).date,to:entries[0].date});
    return journal.saveGeneratedHistory({expectedRevision:history.revision,body:preview.body,sourceEntryIds:preview.sourceEntryIds,generator:'local'});
  }
  const deliver=async()=>{
    if(closed||!started||!journal.settings().autoEnabled)return{outcome:'pending',channel:'journal',detail:'自动日记已停止。'};
    const controller=new AbortController();active=controller;
    try{
      const pending=eligibleDates(),retries=new Map(journal.db.prepare('SELECT date,retry_at FROM mochi_journal_generation_attempts WHERE role=?').all(journal.role).map(row=>[row.date,row.retry_at]));
      const batch=pending.filter(day=>(retries.get(day)??0)<=now()).slice(0,JOURNAL_BATCH_SIZE);
      let generated=0,failed=0;
      for(const day of batch){
        if(controller.signal.aborted||!journal.settings().autoEnabled)break;
        try{
          const result=await cancellable(()=>generate(day,{journal,signal:controller.signal}),controller.signal);
          if(controller.signal.aborted)break;
          let entry=journal.get(`diary:${day}`);
          if(result?.body!==undefined&&!result?.id)entry=journal.saveGeneratedDay({...result,date:day});
          if(!entry&&!result?.protected)throw new Error('生成接口未保存有来源的日记。');
          journal.db.prepare('DELETE FROM mochi_journal_generation_attempts WHERE role=? AND date=?').run(journal.role,day);generated++;
        }catch(error){
          if(controller.signal.aborted)break;
          const raw=String(error.message??error),detail=isSensitiveMemoryText(raw)?'本次生成失败，请稍后重试。':raw.slice(0,300);
          journal.db.prepare('INSERT INTO mochi_journal_generation_attempts VALUES(?,?,?,?) ON CONFLICT(role,date) DO UPDATE SET retry_at=excluded.retry_at,error=excluded.error').run(journal.role,day,now()+tickMs,detail);failed++;
        }
      }
      if(controller.signal.aborted)return{outcome:'pending',channel:'journal',detail:'日记生成已取消，尚未处理的活动仍保留。'};
      refreshHistory();
      const remaining=eligibleDates().length;
      return{outcome:remaining?(failed?'failed':'pending'):'delivered',channel:'journal',detail:`已处理${generated}个活动日；${remaining}个活动日待生成${failed?`，本轮${failed}项失败，稍后重试`:''}。`};
    }finally{if(active===controller)active=null;}
  };
  const makeCore=()=>createScheduler({store:scoped,now,timeZone:zone,tickMs,deliver});
  let core=makeCore();
  function reconcile(){
    const settings=journal.settings(),rows=ownRows();
    let keeper=null;
    for(const row of rows){if(settings.autoEnabled&&!keeper&&row.time_of_day===settings.dailyTime&&row.frequency==='daily'){keeper=row;continue;}base.cancelSchedule(row.id);}
    if(!settings.autoEnabled)return null;
    if(!keeper){const nextRunAt=eligibleDates().length?now():nextOccurrence({frequency:'daily',time:settings.dailyTime},now(),zone).nextRunAt;
      keeper=base.createSchedule({title:settings.diaryName,kind:'notify',frequency:'daily',timeOfDay:settings.dailyTime,timeZone:zone,note:'有实际活动才生成本机日记；不发送群消息。',nextRunAt,sessionId:owner,agentId:ownerAgent});
    }else if(eligibleDates().length&&Date.parse(keeper.next_run_at)>now()){
      db.prepare('UPDATE mochi_schedules SET next_run_at=? WHERE id=? AND session_id=? AND agent_id=?').run(new Date(now()).toISOString(),keeper.id,owner,ownerAgent);keeper=owns(keeper.id);
    }
    return keeper;
  }
  return{
    async start(){
      if(closed)throw new Error('日记调度器已关闭。');if(startPromise)return startPromise;if(started)return;
      started=true;
      startPromise=(async()=>{reconcile();if(journal.settings().autoEnabled){core.start();await core.tick();}})();
      try{return await startPromise;}finally{startPromise=null;}
    },
    async configure(input){
      if(closed)throw new Error('日记调度器已关闭。');active?.abort();await core.stop();
      const settings=input===undefined?journal.settings():journal.configure(input);reconcile();
      core=makeCore();
      if(started&&settings.autoEnabled)core.start();return settings;
    },
    async tick(){if(!closed&&started&&journal.settings().autoEnabled)return core.tick();},
    async close(){if(closed)return;closed=true;started=false;active?.abort();await core.stop();db.close();},
    refreshHistory,
    status(){return{started,closed,pendingTimer:core.pendingTimer,task:closed?null:ownRows()[0]??null,pendingDates:closed?[]:eligibleDates(),failures:closed?[]:journal.db.prepare('SELECT date,retry_at,error FROM mochi_journal_generation_attempts WHERE role=? ORDER BY date').all(journal.role)};},
  };
}
