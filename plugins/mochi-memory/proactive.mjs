import { createHash } from 'node:crypto';
import { isSensitiveMemoryText } from './mem-store.mjs';
import { normalizeMemoryRole, shouldObserveTopic } from './role-policy.mjs';

const topics=new Set(['file_format','layout_style','communication_style','class_portrait']);
const digest=text=>createHash('sha256').update(text).digest('hex');
export function userEvidence(session,event) {
  const message=event?.data;
  if(event?.type!=='user/message'||message?.role!=='user'||message.source?.kind!=='user'||typeof message.id!=='string'||typeof session?.id!=='string')return null;
  const text=message.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n')??'';
  if(!text.trim()||text.length>12000||isSensitiveMemoryText(text))return null;
  return{sessionId:session.id,messageId:message.id,text};
}

/** Conservative local observations. Broader semantic observations use the evidence-checked tool. */
export function localObservations(text) {
  const observations=[];
  const sentences=text.split(/[。！？\n]/).map(row=>row.trim()).filter(Boolean);
  for(const quote of sentences) {
    if(quote.length>220||/不要|不用|别用|不需要|不能|不喜欢|不想|而不是|例如|比如|示例|[“”「」"]|他说|她说|老师说|同学说|转述/.test(quote))continue;
    // A third person's preference is not automatically the user's preference.
    if(/给我|帮我|我要|我想|我需要|我(?:更|一直|都|比较)?(?:喜欢|习惯)|^(?:请|输出|导出|生成|做成|保存为|以后)/.test(quote)) {
      const formats=[['Word',/\bword\b|docx|可编辑的文档/i],['PDF',/\bpdf\b/i],['Excel',/\bexcel\b|xlsx|电子表格/i],['PowerPoint',/\bpptx?\b|powerpoint/i]];
      const found=formats.filter(([,pattern])=>pattern.test(quote));
      // A request for multiple formats is a workflow choice, not a unique default.
      if(found.length===1)observations.push({topic:'file_format',value:found[0][0],summary:`选择 ${found[0][0]} 作为交付文件格式。`,quote});
      if(/简洁|少一点文字|短一点/.test(quote))observations.push({topic:'communication_style',value:'concise',summary:'选择简洁、少一些文字的表达。',quote});
      if(/分栏|双栏/.test(quote))observations.push({topic:'layout_style',value:'columns',summary:'制作材料时选择分栏排版。',quote});
    }
  }
  return observations.slice(0,3);
}

export class ProactiveMemory {
  constructor(store,{now=Date.now,role}={}) {
    this.store=store;this.db=store.db;this.now=now;this.role=normalizeMemoryRole(role);
    this.db.exec(`CREATE TABLE IF NOT EXISTS mochi_memory_learning_settings (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO mochi_memory_learning_settings VALUES(1,1);
      CREATE TABLE IF NOT EXISTS mochi_memory_observations (id TEXT PRIMARY KEY,topic TEXT NOT NULL,value TEXT NOT NULL,summary TEXT NOT NULL,quote TEXT NOT NULL,session_id TEXT NOT NULL,message_id TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mochi_memory_habits (key TEXT PRIMARY KEY,topic TEXT NOT NULL,value TEXT NOT NULL,state TEXT NOT NULL,memory_id INTEGER,updated_at TEXT NOT NULL);`);
  }
  enabled(){return !!this.db.prepare('SELECT enabled FROM mochi_memory_learning_settings WHERE id=1').get().enabled;}
  configure(enabled){if(typeof enabled!=='boolean')throw new Error('主动记忆开关无效。');this.db.prepare('UPDATE mochi_memory_learning_settings SET enabled=? WHERE id=1').run(Number(enabled));return this.snapshot();}
  observe(observation,evidence) {
    if(!this.enabled())return{status:'disabled'};
    const {topic}=observation;
    if(!shouldObserveTopic(this.role,topic))return{status:'not-applicable',message:'这类自动习惯观察不适用于本机角色；明确要求记住的内容仍可单独保存。'};
    const value=String(observation.value??'').trim().toLowerCase(),summary=String(observation.summary??'').trim(),quote=String(observation.quote??'').trim();
    if(!topics.has(topic)||!value||value.length>80||summary.length<4||summary.length>180||quote.length<4||quote.length>220)throw new Error('观察需要明确主题、简短总结和原句依据。');
    if(!evidence?.text?.includes(quote)||typeof evidence.sessionId!=='string'||typeof evidence.messageId!=='string')throw new Error('找不到对应的真实用户原句，观察未保存。');
    if(isSensitiveMemoryText(`${summary}\n${quote}`)||/某同学|学生姓名|家庭住址|电话号码|智商|精神疾病|抑郁|残疾|宗教|民族/.test(`${summary}\n${quote}`))throw new Error('这类内容不适合形成长期习惯记录。');
    if(topic==='class_portrait'&&!/我们班|这个班|本班|班级/.test(quote))throw new Error('班级观察需要明确的班级原句，不能推断个人画像。');
    const key=digest(`${topic}|${value.toLowerCase()}`),id=digest(`${key}|${evidence.sessionId}|${evidence.messageId}`),at=new Date(this.now()).toISOString();
    const habit=this.db.prepare('SELECT * FROM mochi_memory_habits WHERE key=?').get(key);
    if(habit?.state==='dismissed')return{status:'dismissed'};
    this.db.prepare('INSERT OR IGNORE INTO mochi_memory_observations VALUES(?,?,?,?,?,?,?,?)').run(id,topic,value,summary,quote,evidence.sessionId,evidence.messageId,at);
    this.db.prepare('INSERT OR IGNORE INTO mochi_memory_habits VALUES(?,?,?,\'observing\',NULL,?)').run(key,topic,value,at);
    const cutoff=new Date(this.now()-90*86400000).toISOString();
    const rows=this.db.prepare('SELECT * FROM mochi_memory_observations WHERE topic=? AND value=? AND created_at>=? ORDER BY created_at').all(topic,value,cutoff);
    const sessions=new Set(rows.map(row=>row.session_id));
    // Different turns in one task do not by themselves establish a lasting preference.
    if(rows.length>=3&&sessions.size>=2&&habit?.state!=='learned') {
      // A different repeated choice must not silently replace another learned default.
      const conflict=this.db.prepare("SELECT * FROM mochi_memory_habits WHERE topic=? AND state='learned' AND key<>?").get(topic,key);
      if(conflict&&topic==='file_format'){
        this.db.prepare("UPDATE mochi_memory_habits SET state='needs-review',updated_at=? WHERE key=?").run(at,key);
        this.prune();
        return{status:'needs-review',key,evidenceCount:rows.length};
      }
      const content=topic==='class_portrait'?`暂定班级印象（来自多次对话，仍可修正）：${summary}`:`暂定习惯（来自多次对话，仍可修正）：${summary}`;
      const note=this.store.note({kind:topic==='class_portrait'?'convention':'preference',content,source:'observed',importance:0.65,sourceTaskIds:rows.map(row=>`${row.session_id}:${row.message_id}`)});
      this.db.prepare("UPDATE mochi_memory_habits SET state='learned',memory_id=?,updated_at=? WHERE key=?").run(note.id,at,key);
      this.prune();return{status:'learned',key,memoryId:note.id,evidenceCount:rows.length};
    }
    this.prune();return{status:habit?.state??'observing',key,evidenceCount:rows.length};
  }
  capture(session,event) {
    const evidence=userEvidence(session,event);if(!evidence||!this.enabled())return;
    for(const observation of localObservations(evidence.text))this.observe(observation,evidence);
  }
  dismissMemory(memoryId){this.db.prepare("UPDATE mochi_memory_habits SET state='dismissed' WHERE memory_id=?").run(memoryId);}
  clear(){this.db.prepare("UPDATE mochi_memory_habits SET state='dismissed'").run();return this.db.prepare('DELETE FROM mochi_memory_observations').run().changes;}
  dismiss(key){if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw new Error('观察ID无效。');const habit=this.db.prepare('SELECT * FROM mochi_memory_habits WHERE key=?').get(key);if(!habit)throw new Error('观察不存在。');if(habit.memory_id&&this.store.listAll().some(row=>row.id===habit.memory_id))this.store.forget(habit.memory_id);this.db.prepare("UPDATE mochi_memory_habits SET state='dismissed' WHERE key=?").run(key);return this.snapshot();}
  prune(){this.db.prepare('DELETE FROM mochi_memory_observations WHERE id NOT IN (SELECT id FROM mochi_memory_observations ORDER BY created_at DESC LIMIT 2000)').run();}
  snapshot(){
    const habits=this.db.prepare("SELECT * FROM mochi_memory_habits WHERE state<>'dismissed' ORDER BY updated_at DESC LIMIT 100").all();
    return{enabled:this.enabled(),role:this.role,habits:habits.filter(habit=>shouldObserveTopic(this.role,habit.topic)).map(habit=>({...habit,evidence:this.db.prepare('SELECT summary,quote,session_id,message_id,created_at FROM mochi_memory_observations WHERE topic=? AND value=? ORDER BY created_at DESC LIMIT 8').all(habit.topic,habit.value)}))};
  }
}
