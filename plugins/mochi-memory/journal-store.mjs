import { randomUUID } from 'node:crypto';
import { isSensitiveMemoryText } from './mem-store.mjs';

export const JOURNAL_LIMITS = Object.freeze({ title:120, summary:2000, diaryBody:12000, historyBody:24000, activities:10000, dayActivities:1200, dayCharacters:240000, entries:2000, versions:8000, sourceIds:1200, previewEntries:120 });
const roles=new Set(['teacher','classroom']), kinds=new Set(['task','classroom','conversation']);
const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const clockFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const clone=value=>JSON.parse(JSON.stringify(value));
const text=(value,max,{empty=false,trim=false}={})=>{
  if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail('JOURNAL_INVALID_INPUT',`内容需为${empty?'0':'1'}至${max}字。`);
  if(isSensitiveMemoryText(value))fail('JOURNAL_SENSITIVE_CONTENT','敏感内容不进入日记或历史。');
  return trim?value.trim():value;
};
const identifier=value=>{
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\u0000-\u001f]/.test(value))fail('JOURNAL_INVALID_INPUT','来源ID无效。');
  return value;
};
const ids=(value,max)=>{
  if(!Array.isArray(value)||value.length>max)fail('JOURNAL_INVALID_INPUT','来源数量无效。');
  const checked=value.map(identifier);
  if(new Set(checked).size!==checked.length)fail('JOURNAL_INVALID_INPUT','来源ID不能重复。');
  return checked;
};
export function journalDate(at) {
  if(!Number.isSafeInteger(at)||at<0||!Number.isFinite(new Date(at).getTime()))fail('JOURNAL_INVALID_INPUT','活动时间无效。');
  const parts=Object.fromEntries(dateFormatter.formatToParts(at).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const date=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)fail('JOURNAL_INVALID_INPUT','日期需为真实的YYYY-MM-DD。');
  return value;
};

/** Caller owns the existing SQLite connection and authenticated Host boundary. */
export class JournalStore {
  constructor(db,{role,now=Date.now}={}) {
    if(!roles.has(role)||typeof now!=='function'||typeof db?.prepare!=='function')fail('JOURNAL_INVALID_INPUT','需要有效角色与现有SQLite连接。');
    this.db=db;this.role=role;this.now=now;
    db.exec(`CREATE TABLE IF NOT EXISTS mochi_journal_settings(role TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mochi_journal_activities(role TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,at INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(role,id));
      CREATE INDEX IF NOT EXISTS mochi_journal_activity_day ON mochi_journal_activities(role,date,at);
      CREATE TABLE IF NOT EXISTS mochi_journal_entries(role TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(role,id),UNIQUE(role,date));
      CREATE TABLE IF NOT EXISTS mochi_journal_history(role TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mochi_journal_versions(role TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(role,id,revision));`);
    const at=this.timestamp();
    db.prepare('INSERT OR IGNORE INTO mochi_journal_settings VALUES(?,?)').run(role,JSON.stringify({role,diaryName:'Mochi日记',historyName:'Mochi的历史',dailyTime:'21:30',autoEnabled:true,revision:0,updatedAt:at}));
    db.prepare('INSERT OR IGNORE INTO mochi_journal_history VALUES(?,?)').run(role,JSON.stringify({id:'history',role,title:'Mochi的历史',body:'',edited:false,generator:'local',sourceEntryIds:[],revision:0,createdAt:at,updatedAt:at}));
  }
  timestamp(){const at=this.now();journalDate(at);return at;}
  atomic(work){
    const name='journal_'+randomUUID().replaceAll('-','');this.db.exec(`SAVEPOINT ${name}`);
    try{const result=work();this.db.exec(`RELEASE ${name}`);return result;}
    catch(error){this.db.exec(`ROLLBACK TO ${name}`);this.db.exec(`RELEASE ${name}`);throw error;}
  }
  read(table,id){
    const row=id===undefined?this.db.prepare(`SELECT data FROM ${table} WHERE role=?`).get(this.role):this.db.prepare(`SELECT data FROM ${table} WHERE role=? AND id=?`).get(this.role,id);
    return row?JSON.parse(row.data):null;
  }
  revision(prior,expected){if(!Number.isSafeInteger(expected)||expected!==prior.revision)fail('JOURNAL_REVISION_CONFLICT','内容已变化，请刷新后再保存。');}
  archive(prior,reason){
    const count=this.db.prepare('SELECT count(*) AS n FROM mochi_journal_versions WHERE role=?').get(this.role).n;
    if(count>=JOURNAL_LIMITS.versions)fail('JOURNAL_LIMIT_REACHED','版本记录已达上限，未删除旧正文。');
    this.db.prepare('INSERT INTO mochi_journal_versions VALUES(?,?,?,?,?,?)').run(this.role,prior.id,prior.revision,JSON.stringify(prior),reason,this.timestamp());
  }
  versions(id){identifier(id);return this.db.prepare('SELECT data,reason,at FROM mochi_journal_versions WHERE role=? AND id=? ORDER BY revision DESC').all(this.role,id).map(row=>({...JSON.parse(row.data),versionReason:row.reason,archivedAt:row.at}));}
  settings(){return this.read('mochi_journal_settings');}
  configure(input){return this.atomic(()=>{
    const prior=this.settings();this.revision(prior,input?.expectedRevision);
    const next={...prior};
    for(const key of ['diaryName','historyName'])if(input[key]!==undefined)next[key]=text(input[key],JOURNAL_LIMITS.title,{trim:true});
    if(input.dailyTime!==undefined){if(typeof input.dailyTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyTime))fail('JOURNAL_INVALID_INPUT','每日时间需为HH:mm。');next.dailyTime=input.dailyTime;}
    if(input.autoEnabled!==undefined){if(typeof input.autoEnabled!=='boolean')fail('JOURNAL_INVALID_INPUT','自动日记开关无效。');next.autoEnabled=input.autoEnabled;}
    next.revision++;next.updatedAt=this.timestamp();
    this.archive({...prior,id:'settings'},'configure');
    this.db.prepare('UPDATE mochi_journal_settings SET data=? WHERE role=?').run(JSON.stringify(next),this.role);return clone(next);
  });}
  recordActivity(input){return this.atomic(()=>{
    const id=identifier(input?.id),at=input.at,day=journalDate(at);
    if(at>this.timestamp()||!kinds.has(input.kind))fail('JOURNAL_INVALID_INPUT','活动类型或时间无效。');
    const activity={id,role:this.role,kind:input.kind,at,date:day,summary:text(input.summary,JOURNAL_LIMITS.summary),sourceIds:ids(input.sourceIds??[],20)};
    const prior=this.read('mochi_journal_activities',id);
    if(prior){if(JSON.stringify(prior)!==JSON.stringify(activity))fail('JOURNAL_ACTIVITY_CONFLICT','同一活动ID的内容不能变化。');return prior;}
    const count=this.db.prepare('SELECT count(*) AS n FROM mochi_journal_activities WHERE role=?').get(this.role).n;
    const daySources=this.daySources(day),daySize=daySources.reduce((sum,row)=>sum+row.summary.length,0);
    if(count>=JOURNAL_LIMITS.activities||daySources.length>=JOURNAL_LIMITS.dayActivities||daySize+activity.summary.length>JOURNAL_LIMITS.dayCharacters)fail('JOURNAL_LIMIT_REACHED','活动记录已达上限，未删除已有依据。');
    this.db.prepare('INSERT INTO mochi_journal_activities VALUES(?,?,?,?,?)').run(this.role,id,day,at,JSON.stringify(activity));return clone(activity);
  });}
  daySources(day){date(day);return this.db.prepare('SELECT data FROM mochi_journal_activities WHERE role=? AND date=? ORDER BY at,id').all(this.role,day).map(row=>JSON.parse(row.data));}
  recordedDates(){return this.db.prepare('SELECT DISTINCT date FROM mochi_journal_activities WHERE role=? ORDER BY date').all(this.role).map(row=>row.date);}
  list(){return this.db.prepare('SELECT data FROM mochi_journal_entries WHERE role=? ORDER BY date DESC').all(this.role).map(row=>JSON.parse(row.data));}
  get(id){identifier(id);return this.read('mochi_journal_entries',id);}
  checkedDay(day){date(day);if(day>journalDate(this.timestamp()))fail('JOURNAL_INVALID_INPUT','不能生成未来日记。');return day;}
  activitySources(day,sourceIds){
    const selected=ids(sourceIds,JOURNAL_LIMITS.sourceIds),available=new Map(this.daySources(day).map(row=>[row.id,row]));
    if(!selected.length||selected.some(id=>!available.has(id)))fail('JOURNAL_SOURCE_REQUIRED','日记必须有本角色当日已保存的真实活动来源。');
    return selected.map(id=>available.get(id));
  }
  generateDay(day){return this.atomic(()=>{
    this.checkedDay(day);const existing=this.get(`diary:${day}`);if(existing?.edited)return existing;
    const sources=this.daySources(day);if(!sources.length)return null;
    if(existing&&sources.every(row=>existing.sourceIds.includes(row.id)))return existing;
    const labels={task:'任务记录',classroom:'课堂记录',conversation:'值得保留的互动'};
    const body='以下内容依据今天实际保存的活动整理。\n\n'+sources.map(row=>`${clockFormatter.format(row.at)} · ${labels[row.kind]}\n${row.summary}`).join('\n\n');
    if(body.length>JOURNAL_LIMITS.diaryBody)fail('JOURNAL_LIMIT_REACHED','当日原始活动较长，请依据已有来源生成有界摘要；原记录仍完整保留。');
    return this.saveDay({date:day,title:`${this.settings().diaryName} · ${day}`,body,sourceIds:sources.map(row=>row.id)},'local');
  });}
  saveGeneratedDay(input){return this.atomic(()=>this.saveDay(input,'model'));}
  saveDay(input,generator){
    const day=this.checkedDay(input?.date),sources=this.activitySources(day,input.sourceIds);
    const id=`diary:${day}`,prior=this.get(id);
    if(prior?.edited)return{protected:true,entry:prior};
    const title=text(input.title??`${this.settings().diaryName} · ${day}`,JOURNAL_LIMITS.title,{trim:true}),body=text(input.body,JOURNAL_LIMITS.diaryBody);
    if(prior&&prior.title===title&&prior.body===body&&prior.generator===generator&&JSON.stringify(prior.sourceIds)===JSON.stringify(input.sourceIds))return prior;
    if(!prior&&this.list().length>=JOURNAL_LIMITS.entries)fail('JOURNAL_LIMIT_REACHED','日记篇数已达上限，原日记未删除。');
    const at=this.timestamp(),entry={id,role:this.role,date:day,title,body,sourceIds:sources.map(row=>row.id),sources,edited:false,generator,revision:prior?prior.revision+1:0,createdAt:prior?.createdAt??at,updatedAt:at};
    if(prior)this.archive(prior,'generate-day');
    this.db.prepare('INSERT INTO mochi_journal_entries VALUES(?,?,?,?) ON CONFLICT(role,id) DO UPDATE SET data=excluded.data').run(this.role,id,day,JSON.stringify(entry));return clone(entry);
  }
  edit(input){return this.atomic(()=>{
    const prior=this.get(input?.id);if(!prior)fail('JOURNAL_NOT_FOUND','日记不存在。');this.revision(prior,input.expectedRevision);
    if(input.title===undefined&&input.body===undefined)fail('JOURNAL_INVALID_INPUT','请提供标题或正文。');
    const next={...prior,title:input.title===undefined?prior.title:text(input.title,JOURNAL_LIMITS.title,{trim:true}),body:input.body===undefined?prior.body:text(input.body,JOURNAL_LIMITS.diaryBody),edited:true,revision:prior.revision+1,updatedAt:this.timestamp()};
    this.archive(prior,'manual-edit');this.db.prepare('UPDATE mochi_journal_entries SET data=? WHERE role=? AND id=?').run(JSON.stringify(next),this.role,next.id);return clone(next);
  });}
  history(){return this.read('mochi_journal_history');}
  entrySources(sourceEntryIds){
    const selected=ids(sourceEntryIds,JOURNAL_LIMITS.previewEntries);
    if(!selected.length||selected.some(id=>!this.get(id)))fail('JOURNAL_SOURCE_REQUIRED','历史总结需要本角色现存日记来源。');
    return selected;
  }
  editHistory(input){return this.atomic(()=>{
    const prior=this.history();this.revision(prior,input?.expectedRevision);
    if(input.title===undefined&&input.body===undefined)fail('JOURNAL_INVALID_INPUT','请提供历史标题或正文。');
    const next={...prior,title:input.title===undefined?prior.title:text(input.title,JOURNAL_LIMITS.title,{trim:true}),body:input.body===undefined?prior.body:text(input.body,JOURNAL_LIMITS.historyBody,{empty:true}),sourceEntryIds:input.sourceEntryIds===undefined?prior.sourceEntryIds:this.entrySources(input.sourceEntryIds),edited:true,revision:prior.revision+1,updatedAt:this.timestamp()};
    this.archive(prior,'manual-edit-history');this.db.prepare('UPDATE mochi_journal_history SET data=? WHERE role=?').run(JSON.stringify(next),this.role);return clone(next);
  });}
  saveGeneratedHistory(input){return this.atomic(()=>{
    const prior=this.history();this.revision(prior,input?.expectedRevision);
    const sourceEntryIds=this.entrySources(input.sourceEntryIds);
    if(prior.edited)return{protected:true,history:prior};
    const body=text(input.body,JOURNAL_LIMITS.historyBody),generator=input.generator??'local';
    if(!['local','model'].includes(generator))fail('JOURNAL_INVALID_INPUT','历史生成方式无效。');
    if(prior.body===body&&prior.generator===generator&&JSON.stringify(prior.sourceEntryIds)===JSON.stringify(sourceEntryIds))return prior;
    const next={...prior,title:prior.revision===0?this.settings().historyName:prior.title,body,sourceEntryIds,edited:false,generator,revision:prior.revision+1,updatedAt:this.timestamp()};
    this.archive(prior,'generate-history');this.db.prepare('UPDATE mochi_journal_history SET data=? WHERE role=?').run(JSON.stringify(next),this.role);return clone(next);
  });}
  summarizeRange({from,to}={}){
    date(from);date(to);if(from>to)fail('JOURNAL_INVALID_INPUT','开始日期不能晚于结束日期。');
    const entries=this.list().filter(row=>row.date>=from&&row.date<=to).reverse();
    if(entries.length>JOURNAL_LIMITS.previewEntries)fail('JOURNAL_LIMIT_REACHED','预览范围过大，请缩小日期范围；原日记仍保留。');
    const suffix='\n（摘录，完整正文保留在原日记中。）';
    const overhead=entries.reduce((sum,row)=>sum+`${row.date} · ${row.title}\n`.length+suffix.length+2,0);
    const budget=Math.max(0,Math.min(1200,Math.floor((JOURNAL_LIMITS.historyBody-overhead)/Math.max(entries.length,1))));
    const sources=entries.map(entry=>({id:entry.id,date:entry.date,revision:entry.revision,title:entry.title,excerpt:entry.body.slice(0,budget),truncated:entry.body.length>budget}));
    const body=sources.map(row=>`${row.date} · ${row.title}\n${row.excerpt}${row.truncated?suffix:''}`).join('\n\n');
    return{method:'local-merge',generator:'local',from,to,title:this.settings().historyName,body,sourceEntryIds:entries.map(row=>row.id),sources,empty:entries.length===0};
  }
}
