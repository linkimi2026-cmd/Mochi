import React from 'react';
import {JournalPages,journalStyles} from './journal-ui.mjs';
import {SidebarAction,sidebarIcons} from '../mochi-onboarding/sidebar-action.mjs';
const h=React.createElement;
const kinds={preference:'个人偏好',task_fact:'任务事实',org_knowledge:'组织知识',convention:'班级约定'};
const sources={user_statement:'你曾经说过',repeated:'多次提到',explicit_request:'你明确要求记住',observed:'日常对话形成的暂定习惯'};
export const inject=['slots'];
export function apply(ctx) {
  let open=false,state=null,error='',busy=false,edit=null,forget=null;
  const listeners=new Set(),notify=()=>listeners.forEach(fn=>fn());
  const api=async(path,data)=>{
    const response=await fetch('/api/mochi-memory'+path,{credentials:'same-origin',...(data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'记忆暂时无法读取。'),{code:value.code,status:response.status});if(data!==undefined&&['/save','/pin','/forget','/learning','/dismiss-observation'].includes(path))window.dispatchEvent(new CustomEvent('mochi-memory-updated'));return value;
  };
  const act=async work=>{if(busy)return;busy=true;error='';notify();try{state=await work();}catch(e){error=e.message;}finally{busy=false;notify();}};
  const show=event=>{event?.preventDefault?.();open=true;notify();void act(()=>api('/state'));};
  const useChange=()=>{const[,force]=React.useReducer(n=>n+1,0);React.useEffect(()=>{listeners.add(force);return()=>listeners.delete(force);},[]);};
  function Entry({wide}){return h(SidebarAction,{wide,label:'记忆',description:'查看记忆',icon:sidebarIcons.memory,onClick:show});}
  function Panel(){
    useChange();const ref=React.useRef(null),anchor=React.useRef(null),[query,setQuery]=React.useState(''),[page,setPage]=React.useState('diary');
    React.useEffect(()=>{if(open&&!ref.current.open){anchor.current=document.activeElement;ref.current.showModal();}else if(!open&&ref.current.open){ref.current.close();anchor.current?.focus?.();}},[open]);
    const close=()=>{open=false;forget=null;notify();};
    const rows=(state?.rows??[]).filter(row=>!query||`${row.content} ${row.summary}`.includes(query));
    return h('dialog',{ref,className:'mochi-memory-panel','aria-labelledby':'mochi-memory-title',onCancel:e=>{e.preventDefault();close();}},
      h('header',null,h('h2',{id:'mochi-memory-title'},'Mochi 记住了什么'),h('button',{type:'button',onClick:close},'关闭')),
      h('nav',{className:'mochi-memory-nav',role:'tablist','aria-label':'日记、历史与偏好'},...Object.entries({diary:'日记',history:'历史',memory:'偏好与观察'}).map(([id,title])=>h('button',{type:'button',role:'tab',id:'mochi-memory-tab-'+id,'aria-controls':'mochi-memory-'+id,'aria-selected':page===id,tabIndex:page===id?0:-1,key:id,onClick:()=>setPage(id),onKeyDown:event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=['diary','history','memory'],index=tabs.indexOf(page),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowLeft'?2:1))%3;setPage(tabs[next]);document.getElementById('mochi-memory-tab-'+tabs[next])?.focus();}},title))),
      h(JournalPages,{api,open,page,onPage:setPage}),
      h('section',{id:'mochi-memory-memory',hidden:page!=='memory',role:'tabpanel','aria-labelledby':'mochi-memory-tab-memory','data-mochi-envelope':'true'},
      h('p',null,'这里沿用原来的本机记忆。你可以查看来源、更正内容，或者让 Mochi 忘记。称呼请在“我的资料”中设置。'),
      state?.learning&&h('section',null,h('label',null,h('input',{type:'checkbox',checked:state.learning.enabled,disabled:busy,onChange:e=>act(()=>api('/learning',{enabled:e.target.checked}))}),' 从日常对话中主动了解我'),
        h('p',{className:'mochi-memory-muted'},'临时选择先观察，跨对话反复出现才形成暂定习惯。关闭后停止新学习，已有记忆仍可检查或忘记。'),
        state.learning.habits.length>0&&h('details',null,h('summary',null,'Mochi 正在了解什么'),...state.learning.habits.map(habit=>h('section',{key:habit.key,className:'mochi-memory-edit'},
          h('p',null,habit.evidence[0]?.summary||habit.value),
          h('small',null,`${{observing:'还在观察',learned:'已形成暂定习惯','needs-review':'发现不同选择，暂不替换'}[habit.state]||habit.state} · `),
          h('small',null,`${habit.evidence.length} 条近期依据`),h('ul',null,...habit.evidence.map(row=>h('li',{key:row.session_id+row.message_id},h('p',null,row.quote),h('small',null,new Date(row.created_at).toLocaleDateString('zh-CN'))))),
          h('button',{type:'button',disabled:busy,onClick:()=>act(()=>api('/dismiss-observation',{key:habit.key}))},'不要这样记'))))),
      h('div',{className:'mochi-memory-tools'},h('input',{'aria-label':'搜索记忆',placeholder:'找一条记忆',value:query,onChange:e=>setQuery(e.target.value)}),h('button',{type:'button',disabled:busy,onClick:()=>{edit={kind:'preference',content:''};forget=null;notify();}},'记住一件事')),
      error&&h('p',{role:'alert'},error),
      edit&&h('section',{className:'mochi-memory-edit'},
        h('h3',null,edit.id?'更正这条记忆':'告诉 Mochi 一件值得记住的事'),
        !edit.id&&h('select',{'aria-label':'记忆类型',value:edit.kind,onChange:e=>{edit={...edit,kind:e.target.value};notify();}},...Object.entries(kinds).map(([key,label])=>h('option',{key,value:key},label))),
        h('textarea',{'aria-label':'记忆内容',value:edit.content,rows:4,maxLength:2000,onChange:e=>{edit={...edit,content:e.target.value};notify();}}),
        h('button',{type:'button',disabled:busy||!edit.content.trim(),onClick:()=>act(async()=>{const result=await api('/save',edit);edit=null;return result;})},'保存记忆'),
        h('button',{type:'button',disabled:busy,onClick:()=>{edit=null;error='';notify();}},'放弃修改')),
      forget&&h('section',{className:'mochi-memory-edit',role:'alert'},h('p',null,'确定让 Mochi 忘记这条吗？'),h('blockquote',null,forget.content),h('p',null,'这条内容会退出检索；原有本机审计记录仍保留快照。'),
        h('button',{type:'button','data-mochi-variant':'danger',disabled:busy,onClick:()=>act(async()=>{const result=await api('/forget',{id:forget.id,expected:forget.content,confirmed:true});forget=null;return result;})},'确认忘记'),
        h('button',{type:'button',onClick:()=>{forget=null;notify();}},'保留')),
      state&&h('p',{className:'mochi-memory-muted'},`${state.stats.active} 条正在使用 · ${state.stats.pinned} 条已固定`),
      !rows.length&&!busy&&h('p',null,query?'没有找到相符的记忆。':'Mochi 会从日常对话里慢慢了解你。你也可以直接告诉它长期偏好，或点“记住一件事”。'),
      h('ul',null,...rows.slice(0,200).map(row=>h('li',{key:row.id},h('p',null,row.content),h('small',null,`${kinds[row.kind]||row.kind} · ${sources[row.source]||'来源未注明'} · ${new Date(row.created_at).toLocaleDateString('zh-CN')} · ${row.expired_at?'已归档':row.pinned?'已固定':'可随时间淡化'}`),
        h('div',{className:'mochi-memory-row-actions'},h('button',{type:'button',disabled:busy,onClick:()=>{edit={id:row.id,kind:row.kind,content:row.content,expected:row.content};forget=null;notify();}},'更正'),
          h('button',{type:'button',disabled:busy,'aria-pressed':!!row.pinned,onClick:()=>act(()=>api('/pin',{id:row.id,expected:row.content,pinned:!row.pinned}))},row.pinned?'取消固定':'固定'),
          h('button',{type:'button',disabled:busy,onClick:()=>{forget=row;edit=null;notify();}},'忘记'))))),
      rows.length>200&&h('p',null,'显示前 200 条，请用搜索缩小范围。')));
  }
  const style=document.createElement('style');style.textContent='.mochi-memory-panel{width:min(660px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:16px;padding:22px;background:var(--dsw-alias-bg-base,#fffefa);color:var(--dsw-alias-label-primary,#403b32)}.mochi-memory-panel::backdrop{background:#0005}.mochi-memory-panel header,.mochi-memory-tools,.mochi-memory-row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mochi-memory-panel header{justify-content:space-between}.mochi-memory-panel h2{font-size:19px;margin:0}.mochi-memory-panel h3{font-size:15px}.mochi-memory-panel p{font-size:13px;line-height:1.6;white-space:pre-wrap}.mochi-memory-panel button,.mochi-memory-panel input,.mochi-memory-panel select,.mochi-memory-panel textarea{color:inherit;font:inherit;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:8px;background:var(--dsw-alias-bg-base,#fffefa);padding:7px 10px}.mochi-memory-panel button:disabled{opacity:.5}.mochi-memory-panel :focus-visible{outline:2px solid currentColor;outline-offset:2px}.mochi-memory-panel textarea{display:block;box-sizing:border-box;width:100%;margin:10px 0}.mochi-memory-panel ul{list-style:none;padding:0}.mochi-memory-panel li{border-top:1px solid var(--dsw-alias-border-l2,#d8d3c7);padding:12px 0}.mochi-memory-panel small,.mochi-memory-muted{color:var(--dsw-alias-label-secondary,#746c60)}.mochi-memory-row-actions{margin-top:8px}.mochi-memory-edit{margin-top:14px;padding:14px;border:1px dashed var(--dsw-alias-border-l2,#d8d3c7);border-radius:10px}.mochi-memory-edit button{margin-right:8px}';document.head.append(style);
  ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'mochi-memory-entry',order:28},Entry));
  style.textContent+=journalStyles;
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'mochi-memory-panel',order:28},Panel));
  window.addEventListener('mochi-open-memory',show);
  ctx.on('dispose',()=>{window.removeEventListener('mochi-open-memory',show);style.remove();listeners.clear();});
}
