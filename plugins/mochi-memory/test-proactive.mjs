import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, openStore } from './mem-store.mjs';
import { ProactiveMemory, localObservations, userEvidence } from './proactive.mjs';
import { createActiveMemoryContext } from './active-context.mjs';

const event=(id,text)=>({type:'user/message',data:{id,role:'user',source:{kind:'user'},content:[{type:'text',text}]}});
function fixture(t,role='teacher'){
  const root=mkdtempSync(join(tmpdir(),'mochi-proactive-')),path=join(root,'memory.sqlite');
  const store=createStore(openStore(path)),learning=new ProactiveMemory(store,{role});
  t.after(()=>{try{store.db.close();}catch{}rmSync(root,{recursive:true,force:true});});
  const capture=(session,id,text='帮我生成 Word 文件')=>learning.capture({id:session},event(id,text));
  return{store,learning,capture,path};
}

test('重复消息幂等，同一任务不建立偏好，跨会话习惯进入新任务上下文',t=>{
  const{store,learning,capture}=fixture(t);
  capture('s1','m1');capture('s1','m1');capture('s1','m2');capture('s1','m3');
  assert.equal(store.stats().total,0);assert.equal(learning.snapshot().habits[0].evidence.length,3);
  capture('s2','m4');assert.equal(store.stats().total,1);
  const note=store.listAll()[0];assert.equal(note.source,'observed');
  const result=createActiveMemoryContext({store,proactive:learning,session:{snapshotEvents:()=>[event('m5','生成一份练习材料')]}});
  assert.match(result.text,/Word/);assert.match(result.text,/暂定/);
  capture('s2','m4');assert.equal(store.stats().total,1);
});

test('只有真实用户原句能作证据，否定、多格式和敏感文本不会本地学习',t=>{
  const{learning}=fixture(t);
  assert.equal(userEvidence({id:'s'},event('1','我的密码是 abc')),null);
  assert.equal(userEvidence({id:'s'},{...event('2','生成 Word'),data:{...event('2','生成 Word').data,source:{kind:'tool'}}}),null);
  for(const text of ['不要给我 Word 文件','比如输出 PDF','输出 Word 和 PDF','学生喜欢 Word','老师说以后都输出 Word','示例：帮我生成 PDF'])assert.deepEqual(localObservations(text),[]);
  assert.throws(()=>learning.observe({topic:'class_portrait',value:'curious',summary:'班级喜欢探索',quote:'我们班喜欢探索'}, {sessionId:'s',messageId:'m',text:'模型自己的猜测'}),/真实用户原句/);
  assert.throws(()=>learning.observe({topic:'class_portrait',value:'quiet',summary:'这是安静的班级',quote:'他喜欢安静'}, {sessionId:'s',messageId:'m',text:'他喜欢安静'}),/班级原句/);
});

test('语义班级观察保留原句，多次后仍明确标为暂定',t=>{
  const{store,learning}=fixture(t),quote='我们班喜欢一起讨论为什么';
  for(let i=0;i<3;i++)learning.observe({topic:'class_portrait',value:'discussion',summary:'班级喜欢共同讨论和提问。',quote},{sessionId:'s'+i,messageId:'m'+i,text:quote});
  assert.match(store.listAll()[0].content,/暂定班级印象/);
  assert.equal(learning.snapshot().habits[0].evidence.length,3);
  const context=createActiveMemoryContext({store,proactive:learning,session:{snapshotEvents:()=>[event('next','你觉得我们班怎么样')]}});
  assert.match(context.text,/共同讨论和提问/);assert.match(context.text,/暂定/);
});

test('不同格式暂不覆盖，关闭持久化，忘记后不会立即重新学回',t=>{
  const{store,learning,capture,path}=fixture(t);
  for(let i=0;i<3;i++)capture('s'+i,'w'+i);
  for(let i=0;i<3;i++)capture('s'+i,'p'+i,'帮我生成 PDF 文件');
  assert.equal(store.stats().total,1);
  assert.equal(learning.snapshot().habits.find(row=>row.value==='pdf').state,'needs-review');
  const note=store.listAll()[0];store.forget(note.id);learning.dismissMemory(note.id);
  capture('s4','w4');assert.equal(store.stats().total,0);
  learning.configure(false);capture('s4','e4','帮我输出 Excel 文件');
  assert.ok(!learning.snapshot().habits.some(row=>row.value==='excel'));
  const reopened=createStore(openStore(path));try{assert.equal(new ProactiveMemory(reopened).enabled(),false);}finally{reopened.db.close();}
});

test('候选可拒绝，清空同时去掉观察并防止重复采集',t=>{
  const{store,learning,capture}=fixture(t);
  capture('s1','m1');const key=learning.snapshot().habits[0].key;
  learning.dismiss(key);capture('s2','m2');assert.equal(learning.snapshot().habits.length,0);
  capture('s1','p1','帮我生成 PDF 文件');assert.ok(learning.clear()>0);
  capture('s2','p2','帮我生成 PDF 文件');assert.equal(learning.snapshot().habits.length,0);assert.equal(store.stats().total,0);
});

test('教室三次跨会话Word请求不学习个人格式，真实班级观察仍可形成暂定印象',t=>{
  const{store,learning,capture}=fixture(t,'classroom');
  for(let i=0;i<3;i++)capture('room-'+i,'word-'+i,'帮我生成 Word 文件');
  assert.equal(store.stats().total,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM mochi_memory_observations').get().count,0,'disallowed requests do not even become hidden observations');
  assert.deepEqual(learning.snapshot().habits,[]);
  const quote='我们班喜欢一起讨论为什么';
  for(let i=0;i<3;i++)learning.observe({topic:'class_portrait',value:'discussion',summary:'班级喜欢共同讨论和提问。',quote},{sessionId:'class-'+i,messageId:'evidence-'+i,text:quote});
  assert.equal(store.stats().total,1);
  assert.equal(learning.snapshot().habits[0].state,'learned');
  assert.match(createActiveMemoryContext({store,proactive:learning,session:{snapshotEvents:()=>[event('next','我们班有什么互动习惯')]}}).text,/共同讨论和提问/);
  assert.throws(()=>learning.observe({topic:'class_portrait',value:'personal',summary:'班级喜欢独自阅读。',quote:'我喜欢独自阅读'},{sessionId:'personal',messageId:'personal',text:'我喜欢独自阅读'}),/班级原句/);
});

test('未知角色不主动学习，用户明确记忆仍可正常保存及关联',t=>{
  const{store,learning,capture}=fixture(t,'unknown');
  for(let i=0;i<3;i++)capture('unknown-'+i,'request-'+i);
  assert.equal(store.stats().total,0);
  assert.equal(learning.observe({topic:'class_portrait',value:'discussion',summary:'班级喜欢共同讨论。',quote:'我们班喜欢一起讨论'},{sessionId:'s',messageId:'m',text:'我们班喜欢一起讨论'}).status,'not-applicable');
  const note=store.note({kind:'preference',content:'用户明确要求：以后需要Word文档。',source:'explicit_request'});
  assert.deepEqual(createActiveMemoryContext({store,proactive:learning,session:{snapshotEvents:()=>[event('explicit','继续制作Word文档')]}}).memoryIds,[note.id]);
});
