import React from 'react';
import {Button} from '@deepseek-ai/dsh-client-ui-primitives';
import {SidebarAction,sidebarIcons} from '../mochi-onboarding/sidebar-action.mjs';
const h = React.createElement, BASE = '/api/mochi-planner';
export const inject = ['slots','conversation'];
export function apply(ctx) {
  let state = null, opened = false, error = '', draft = null, draftRevision = 0, busy = false, disposed = false, timer;
  const listeners = new Set(), delivered = new Set();
  const notify = () => listeners.forEach(fn=>fn());
  const api = async (path, data, headers) => {
    const response = await fetch(BASE+path,{credentials:'same-origin',...(data===undefined?{}:{method:'POST',headers:headers||{'content-type':'application/json'},body:headers?data:JSON.stringify(data)})});
    const value = await response.json();
    if(!response.ok) throw new Error(value.error || '课堂管家暂时无法连接。');
    return value;
  };
  const update = next => { state=next; notify(); };
  const act = async work => {
    if(busy) return;
    busy=true;error='';notify();
    try { await work(); } catch(e) {error=e.message;} finally {busy=false;notify();}
  };
  const edit = candidate => { draftRevision=state?.revision??0;error='';draft={...candidate,lessons:candidate.draftLessons||candidate.lessons}; delete draft.issues;delete draft.draftLessons;opened=true;notify(); };
  const result = value => {
    if(value.saved) { update(value.state);draft=null; }
    else {edit(value.candidate);error=value.candidate.issues.join('\n');}
  };
  const refresh = async () => {
    if(disposed) return;
    try {
      const next=await api('/state');if(disposed)return;update(next);
      for(const paper of next.papers.filter(p=>!p.queued_at && Date.now()-p.created_at<15*60_000)) {
        if(delivered.has(paper.id))continue;
        const accepted=await window.mochiClassroomDesktop?.reminderReady?.({id:paper.id,title:paper.title,body:paper.body,at:paper.created_at});
        if(accepted) {delivered.add(paper.id);await api('/queued',{id:paper.id});}
      }
      for(const paper of next.companionReminders??[]) {
        if(delivered.has(paper.id))continue;
        const accepted=await window.mochiClassroomDesktop?.reminderReady?.({id:paper.id,title:paper.title,body:paper.body,at:paper.createdAt});
        if(accepted) {delivered.add(paper.id);await api('/companion/queued',{key:paper.key});}
      }
    } catch(e) {error=e.message;notify();}
    finally {if(!disposed)timer=setTimeout(refresh,5000);}
  };
  const subscribe = () => {const [,force]=React.useReducer(n=>n+1,0);React.useEffect(()=>{listeners.add(force);return()=>listeners.delete(force);},[]);};
  function Entry({wide}) {subscribe();return h(SidebarAction,{wide,label:'课表',description:'课堂管家',icon:sidebarIcons.planner,onClick:()=>{opened=true;notify();}});}
  function Companion() {
    const c=state.companion;
    const [className,setClassName]=React.useState(c.profile.className||''),[startDate,setStartDate]=React.useState(c.profile.startDate||''),[traits,setTraits]=React.useState(c.traits.map(t=>t.text).join('\n'));
    return h('details',null,h('summary',null,'一起走过的日子'),h('p',null,c.message),
      h('label',null,'班级名字 ',h('input',{value:className,maxLength:80,onChange:e=>setClassName(e.target.value)})),
      h('label',null,'确认的陪伴开始日期 ',h('input',{type:'date',value:startDate,onChange:e=>setStartDate(e.target.value)})),
      h('button',{type:'button',disabled:busy,onClick:()=>act(async()=>update(await api('/companion/profile',{className:className.trim()||null,startDate:startDate||null,confirmed:true})))},'保存陪伴资料'),
      h('label',null,'我确认的班级小特质（每行一条）',h('textarea',{'aria-label':'我确认的班级小特质（每行一条）',value:traits,rows:3,maxLength:10000,onChange:e=>setTraits(e.target.value),placeholder:'例如：大家喜欢互相分享读过的书'})),
      h('button',{type:'button',disabled:busy,onClick:()=>act(async()=>update(await api('/companion/traits',{traits:traits.split('\n').map(t=>t.trim()).filter(Boolean),confirmed:true})))},'保存确认的特质'),
      h('p',{className:'mochi-planner-muted'},'月初回顾只使用已保存的课堂事件和你确认的资料。开始日期未确认时，不猜测陪伴天数。'),
      ...c.receipts.filter(r=>r.letter).slice(-6).reverse().map(r=>h('details',{key:r.key},h('summary',null,r.letter.title),h('p',{style:{whiteSpace:'pre-wrap'}},r.letter.body))));
  }
  function Panel() {
    subscribe();const ref=React.useRef(null), file=React.useRef(null), anchor=React.useRef(null);
    React.useEffect(()=>{if(opened&&!ref.current.open){anchor.current=document.activeElement;ref.current.showModal();}else if(!opened&&ref.current.open){ref.current.close();anchor.current?.focus?.();}},[opened]);
    const close=()=>{opened=false;notify();};
    const rows=draft?.lessons??[];
    const field=(index,key,value)=>{draft={...draft,lessons:rows.map((row,i)=>i===index?{...row,[key]:value,uncertain:false}:row)};notify();};
    return h('dialog',{ref,className:'mochi-planner','aria-labelledby':'mochi-planner-title',onCancel:e=>{e.preventDefault();close();}},
      h('header',null,h('h2',{id:'mochi-planner-title'},'Mochi 的课堂日历'),h('button',{type:'button',onClick:close,'aria-label':'关闭课堂日历'},'关闭')),
      h('p',null,'导入本班课表，Mochi 就会在课前递来小提醒。默认提前 5 分钟，使用北京时间。'),
      h('div',{className:'mochi-planner-actions'},
        h('button',{type:'button',disabled:busy,onClick:()=>file.current.click()},busy?'正在整理…':'导入 Excel / CSV'),
        state?.plan&&h('button',{type:'button',disabled:busy,onClick:()=>edit(state.plan)},'调整课表'),
        state?.plan&&h('button',{type:'button',disabled:busy,onClick:()=>act(async()=>update(await api('/pause',{paused:!state.paused,revision:state.revision})))},state.paused?'恢复提醒':'暂停提醒')),
      h('input',{ref:file,type:'file',accept:'.xlsx,.csv',hidden:true,onChange:e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void act(async()=>result(await api('/import',selected,{'x-mochi-filename':encodeURIComponent(selected.name),'x-mochi-revision':String(state?.revision??0)})));}}),
      h('p',{className:'mochi-planner-muted'},'照片或截图：使用聊天输入框旁的“照片课表”，发送后由当前模型识别并导入；看不清的地方会请你核对。'),
      error&&h('p',{role:'alert',style:{whiteSpace:'pre-wrap'}},error),
      draft?h('section',null,
        h('label',null,'班级 ',h('input',{value:draft.className||'',maxLength:60,onChange:e=>{draft={...draft,className:e.target.value};notify();}})),
        h('label',null,'提前提醒（分钟） ',h('input',{type:'number',min:0,max:30,value:draft.leadMinutes??5,onChange:e=>{draft={...draft,leadMinutes:Number(e.target.value)};notify();}})),
        h('div',{className:'mochi-planner-table'},h('table',null,h('thead',null,h('tr',null,...['星期','科目','开始','结束',''].map((label,i)=>h('th',{key:i},label)))),h('tbody',null,...rows.map((row,i)=>h('tr',{key:i},
          h('td',null,h('select',{'aria-label':`第${i+1}节星期`,value:row.weekday||'',onChange:e=>field(i,'weekday',Number(e.target.value))},h('option',{value:''},'核对'),...[1,2,3,4,5,6,7].map(day=>h('option',{key:day,value:day},`周${'一二三四五六日'[day-1]}`)))),
          ...['subject','start','end'].map(key=>h('td',{key},h('input',{'aria-label':`第${i+1}节${key}`,type:key==='subject'?'text':'time',value:row[key]||'',onChange:e=>field(i,key,e.target.value)}))),
          h('td',null,h('button',{type:'button',onClick:()=>{draft={...draft,lessons:rows.filter((_,j)=>j!==i)};notify();},'aria-label':`移除第${i+1}节`},'移除'))))))),
        h('div',{className:'mochi-planner-actions'},h('button',{type:'button',onClick:()=>{draft={...draft,lessons:[...rows,{weekday:1,subject:'',start:'',end:''}]};notify();}},'添加一节'),
          h('button',{type:'button',disabled:busy,onClick:()=>act(async()=>result(await api('/save',{plan:draft,revision:draftRevision})))},'保存并开始提醒'),
          h('button',{type:'button',onClick:()=>{draft=null;error='';notify();}},'放弃修改')))
      :state?.plan?h('section',null,h('p',null,`${state.plan.className||'本班'} · ${state.plan.lessons.length} 节课 · ${state.paused?'提醒已暂停':'提醒已开启'}`),
        h('ul',null,...state.plan.lessons.map(row=>h('li',{key:row.id},`周${'一二三四五六日'[row.weekday-1]} ${row.start}–${row.end} ${row.subject}`))),
        !state.paused&&h('p',null,'下一次提醒：',state.rows.filter(row=>row.next_run_at).sort((a,b)=>a.next_run_at.localeCompare(b.next_run_at))[0]?.next_run_at?new Date(state.rows.filter(row=>row.next_run_at).sort((a,b)=>a.next_run_at.localeCompare(b.next_run_at))[0].next_run_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'暂无'))
      :h('p',null,'还没有课表。可导入带“星期、科目、开始时间、结束时间”的表格。'),
      h('p',{className:'mochi-planner-muted'},'Mochi 在后台运行时会提醒；关闭软件或关机期间不会执行。假期可暂停，返校后再恢复。'),
      state?.companion&&h(Companion),
      state?.papers?.length>0&&h('details',null,h('summary',null,'最近的小提醒'),...state.papers.slice(0,10).map(p=>h('p',{key:p.id,style:{whiteSpace:'pre-wrap'}},p.body))));
  }
  function Photo({sessionId,inputActions,useInput}) {
    const input=useInput(s=>s), file=React.useRef(null), [message,setMessage]=React.useState('');
    return h('span',null,h(Button,{type:'button',variant:'ghost',size:'md',disabled:input.phase!=='plain',title:'将课表截图或照片放入当前草稿','aria-label':'照片课表',onClick:()=>file.current.click()},'照片课表'),
      h('input',{ref:file,type:'file',accept:'image/png,image/jpeg,image/webp',hidden:true,onChange:e=>{
        const selected=e.target.files?.[0];e.target.value='';if(!selected)return;
        if(selected.size>8*1024*1024){setMessage('图片请控制在 8 MB 以内。');return;}
        const span=inputActions.captureInsertion(), drafts=ctx.conversation.createDrafts(sessionId,[selected]);
        if(!inputActions.addAttachments(drafts.map(row=>row.id))){ctx.conversation.releaseDraftAttachments(drafts);setMessage('当前草稿正在提交，请稍后重试。');return;}
        const inserted=inputActions.insertText('\n请读取这张本班课表，先查 mochi_timetable_status，再调用 mochi_timetable_import 导入并开启课前提醒。只使用明确可读的星期和起止时间，看不清请询问，不要猜测作息。\n',span);
        setMessage(inserted?'已放入草稿，发送后开始识别。':'图片已放入草稿，请补充“导入课表”后发送。');
      }}),message&&h('span',{role:'status',className:'mochi-planner-photo-note'},message));
  }
  const style=document.createElement('style');style.textContent='.mochi-planner{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 40px);box-sizing:border-box;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:16px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32);padding:22px}.mochi-planner::backdrop{background:#0005}.mochi-planner header,.mochi-planner-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.mochi-planner h2{font-size:19px;margin:0}.mochi-planner p{font-size:13px;line-height:1.6}.mochi-planner button,.mochi-planner input,.mochi-planner select,.mochi-planner textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-base,#fffefa);border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;padding:7px 9px}.mochi-planner textarea{display:block;width:100%;box-sizing:border-box;margin-top:8px}.mochi-planner summary{cursor:pointer;margin-top:14px}.mochi-planner button:disabled{opacity:.5}.mochi-planner button:active{transform:translateY(1px)}.mochi-planner :focus-visible{outline:2px solid currentColor;outline-offset:2px}.mochi-planner label{display:block;margin:12px 0}.mochi-planner-table{overflow:auto}.mochi-planner table{width:100%;font-size:13px;border-collapse:collapse}.mochi-planner td,.mochi-planner th{padding:5px;text-align:left}.mochi-planner td input{width:100%;min-width:88px;box-sizing:border-box}.mochi-planner-muted,.mochi-planner-photo-note{color:var(--dsw-alias-label-secondary,#746c60)}.mochi-planner-photo-note{font-size:11px;margin-inline:6px}@media(prefers-reduced-motion:reduce){.mochi-planner button:active{transform:none}}';document.head.append(style);
  ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mochi-planner-entry',order:27},Entry));
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'mochi-planner-panel',order:27},Panel));
  ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'mochi-timetable-photo',order:32},Photo));
  const remove=window.mochiClassroomDesktop?.onOpenReminder?.(()=>{opened=true;notify();});
  void refresh();
  ctx.on('dispose',()=>{disposed=true;clearTimeout(timer);remove?.();style.remove();listeners.clear();});
}
