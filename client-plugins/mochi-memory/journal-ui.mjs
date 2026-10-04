import React from 'react';
import {shanghaiDay,journalMethod,schedulingText,diarySavePayload,historyPreviewPayload,UI_JOURNAL_LIMITS} from './journal-view.mjs';
const h=React.createElement;
const button=(label,onClick,disabled=false,extra={})=>h('button',{type:'button',onClick,disabled,...extra},label);
const label=(text,input)=>h('label',null,h('span',null,text),input);

/** Reads and edits the Host's journal; no parallel diary or nickname storage. */
export function JournalPages({api,open,page,onPage}) {
  const [state,setState]=React.useState(null),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false);
  const lock=React.useRef(false),[letter,setLetter]=React.useState(null),[draft,setDraft]=React.useState(null),[historyDraft,setHistoryDraft]=React.useState(null);
  const [config,setConfig]=React.useState(null),[versions,setVersions]=React.useState(null),[preview,setPreview]=React.useState(null),[count,setCount]=React.useState(60);
  const [day,setDay]=React.useState(shanghaiDay),[from,setFrom]=React.useState(shanghaiDay),[to,setTo]=React.useState(shanghaiDay);
  const run=async work=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await work()}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}};
  const request=(path,data)=>api('/journal'+path,data);
  React.useEffect(()=>{
    if(!open)return;let alive=true;
    request('/state').then(value=>{if(alive)setState(value)}).catch(e=>{if(alive)setError(e.message)});
    return()=>{alive=false};
  },[open]);
  const reload=()=>run(async()=>{setState(await request('/state'));setNotice('已刷新已保存记录；正在编辑的文字仍保留。')});
  const readLetter=id=>run(async()=>{const value=await request('/entry?id='+encodeURIComponent(id));setLetter(value);setDraft(null);setVersions(null);onPage('diary')});
  const saveLetter=()=>run(async()=>{
    const next=await request('/edit',diarySavePayload(letter,draft)),metadata=next.entries.find(row=>row.id===letter.id);
    setState(next);setLetter({...letter,...metadata,body:draft.body});setDraft(null);setNotice('这封日记已保存。');
  });
  const saveHistory=()=>run(async()=>{setState(await request('/history',historyDraft));setHistoryDraft(null);setNotice('这本历史已保存。')});
  const makePreview=()=>run(async()=>{const value=await request('/summarize',{from,to});setPreview({...value,historyRevision:state.history.revision});setNotice(value.empty?'这段时间还没有已有日记，没有编写总结。':'这只是按日期合并的原日记摘录。请检查或修改，再决定是否保存。')});
  const savePreview=()=>run(async()=>{setState(await request('/history',historyPreviewPayload(preview,state.history.title)));setPreview(null);setHistoryDraft(null);setNotice('已把检查过的预览保存为历史；旧版本仍保留。')});
  const generate=()=>run(async()=>{const next=await request('/generate',{date:day});setState(next);setNotice(next.generated?'这一天的日记已整理；人工修改的日记会保留。':'这一天没有已保存活动，没有编写日记。')});
  const configure=()=>run(async()=>{setState(await request('/configure',config));setConfig(null);setNotice('日记设置已保存；实际调度状态见下方。')});
  const oldVersions=id=>run(async()=>{setVersions(await request('/versions?id='+encodeURIComponent(id)))});
  const editor=(value,setValue,kind,save)=>h('div',{className:'mochi-journal-editor'},
    label(kind==='diary'?'这封信的名字':'这本历史的名字',h('input',{'aria-label':kind==='diary'?'日记标题':'历史名称',maxLength:120,value:value.title,onChange:e=>setValue({...value,title:e.target.value})})),
    label('正文',h('textarea',{'aria-label':kind==='diary'?'日记长正文':'历史长正文',rows:16,maxLength:kind==='diary'?12000:24000,value:value.body,onChange:e=>setValue({...value,body:e.target.value})})),
    h('small',null,`${value.body.length} / ${kind==='diary'?12000:24000} 字 · 未保存的修改只在本页`),
    h('div',{className:'mochi-journal-actions'},button(kind==='diary'?'保存这封日记':'保存这本历史',save,busy||!value.title.trim()||(kind==='diary'&&!value.body.trim())),button('放弃这次修改',()=>setValue(null),busy)));
  const savedSources=letter?.sources??[];
  return h(React.Fragment,null,
    error&&h('p',{role:'alert',className:'mochi-journal-error'},error,' 你的未保存文字仍保留；请核对当前保存版本。'),
    notice&&h('p',{role:'status',className:'mochi-memory-muted'},notice),
    busy&&h('p',{role:'status'},'正在处理这封信…'),
    h('section',{id:'mochi-memory-diary',hidden:page!=='diary',role:'tabpanel','aria-labelledby':'mochi-memory-tab-diary',className:'mochi-journal-page','data-mochi-envelope':'true'},
      h('header',null,h('div',null,h('h3',null,state?.settings.diaryName??'Mochi日记'),h('p',{className:'mochi-memory-muted'},'有真实交流或活动的一天，才写一封日记。')),button('刷新记录',reload,busy)),
      state&&h('details',{className:'mochi-journal-settings'},h('summary',null,'日记本名称与每日整理'),
        h('p',null,`每日 ${state.settings.dailyTime}（上海时间） · ${state.settings.autoEnabled?'自动整理已开启':'自动整理已关闭'}`),
        h('p',{role:'status'},schedulingText(state)),
        h('p',{className:'mochi-memory-muted'},'需 Mochi 在运行中。只依据已保存活动；无活动不编写。模型不可用时保留本机活动摘录。'),
        state.scheduling?.failures?.length>0&&h('ul',null,...state.scheduling.failures.map(row=>h('li',{key:row.date},`${row.date}：${row.error}`))),
        !config?button('修改日记设置',()=>setConfig({expectedRevision:state.settings.revision,diaryName:state.settings.diaryName,dailyTime:state.settings.dailyTime,autoEnabled:state.settings.autoEnabled}),busy):h('div',{className:'mochi-journal-editor'},
          label('日记本名称',h('input',{'aria-label':'日记本名称',value:config.diaryName,maxLength:120,onChange:e=>setConfig({...config,diaryName:e.target.value})})),
          label('每日整理时间',h('input',{type:'time','aria-label':'每日整理时间',value:config.dailyTime,onChange:e=>setConfig({...config,dailyTime:e.target.value})})),
          label('自动整理',h('input',{type:'checkbox',checked:config.autoEnabled,onChange:e=>setConfig({...config,autoEnabled:e.target.checked})})),
          button('保存日记设置',configure,busy||!config.diaryName.trim()),button('取消修改设置',()=>setConfig(null),busy))),
      !letter&&h(React.Fragment,null,
        h('div',{className:'mochi-journal-actions'},label('整理哪一天',h('input',{type:'date','aria-label':'整理日记日期',value:day,max:shanghaiDay(),onChange:e=>setDay(e.target.value)})),button('整理这一天',generate,busy||!state||!day)),
        state&&!state.entries.length&&h('div',{className:'mochi-journal-empty','data-mochi-envelope':'true'},h('h3',null,'还没有写好的信'),h('p',null,'正常使用 Mochi 后，它会依据真实记录整理日记。这里不会补写没有发生的一天。')),
        h('div',{className:'mochi-journal-grid'},...(state?.entries??[]).slice(0,count).map(entry=>h('button',{type:'button',key:entry.id,className:'mochi-journal-envelope','data-mochi-envelope':'true','aria-label':`打开 ${entry.date} 的日记：${entry.title}`,disabled:busy,onClick:()=>readLetter(entry.id)},
          h('time',{dateTime:entry.date},entry.date),h('span',{className:'mochi-journal-stamp','aria-hidden':true},'M'),h('strong',null,entry.title),h('span',{className:'mochi-journal-excerpt'},entry.excerpt),h('small',null,journalMethod(entry))))),
        state?.entries.length>count&&button('再看 60 封',()=>setCount(count+60),busy)),
      letter&&h('article',{className:'mochi-journal-letter','data-mochi-envelope':'true'},
        button(draft?'返回信封（放弃未保存修改）':'返回日期信封',()=>{setLetter(null);setDraft(null);setVersions(null)},busy),
        h('header',null,h('div',null,h('time',{dateTime:letter.date},letter.date),h('h3',null,letter.title)),h('small',null,journalMethod(letter))),
        draft?editor(draft,setDraft,'diary',saveLetter):h(React.Fragment,null,h('div',{className:'mochi-journal-body'},letter.body),button('编辑这封信',()=>setDraft({title:letter.title,body:letter.body}),busy)),
        h('details',null,h('summary',null,`这封信的依据 · ${savedSources.length} 条`),...savedSources.map(row=>h('blockquote',{key:row.id},h('p',null,row.summary),h('small',null,new Date(row.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))))),
        button('查看这封信的旧版本',()=>oldVersions(letter.id),busy),
        versions&&h('div',{className:'mochi-journal-versions'},!versions.length?h('p',null,'还没有旧版本。'):versions.map(row=>h('details',{key:row.revision},h('summary',null,`${row.title} · 版本 ${row.revision}`),h('p',{className:'mochi-journal-body'},row.body)))))),
    h('section',{id:'mochi-memory-history',hidden:page!=='history',role:'tabpanel','aria-labelledby':'mochi-memory-tab-history',className:'mochi-journal-page','data-mochi-envelope':'true'},
      h('header',null,h('div',null,h('h3',null,state?.history.title??'Mochi的历史'),h('p',{className:'mochi-memory-muted'},'从已有日记串起一段真实的相处。')),button('刷新历史',reload,busy)),
      state&&h('article',{className:'mochi-journal-letter','data-mochi-envelope':'true'},
        historyDraft?editor(historyDraft,setHistoryDraft,'history',saveHistory):h(React.Fragment,null,
          h('p',{className:'mochi-memory-muted'},`${state.history.edited?'已由你修改，自动整理会保留这份历史。':state.history.generator==='model'?'由模型依据日记整理。':'按已有日记合并的本机摘录。'}`),
          h('div',{className:'mochi-journal-body'},state.history.body||'这本历史还是空白。可以先按日期预览已有日记，再亲自保存。'),
          button('编辑历史名称与长正文',()=>setHistoryDraft({expectedRevision:state.history.revision,title:state.history.title,body:state.history.body}),busy))),
      h('section',{className:'mochi-journal-range','data-mochi-envelope':'true'},h('h3',null,'整理一段历史'),
        h('p',{className:'mochi-memory-muted'},'只预览现有日记的日期摘录，不会自动替换历史正文。'),
        h('div',{className:'mochi-journal-actions'},label('开始日期',h('input',{type:'date','aria-label':'历史开始日期',value:from,max:shanghaiDay(),onChange:e=>setFrom(e.target.value)})),label('结束日期',h('input',{type:'date','aria-label':'历史结束日期',value:to,max:shanghaiDay(),onChange:e=>setTo(e.target.value)})),button('预览这段历史',makePreview,busy||!state||!from||!to||from>to)),
        preview&&h('div',{className:'mochi-journal-preview','data-mochi-envelope':'true'},h('h4',null,`${preview.from} 至 ${preview.to}`),
          preview.empty?h('p',null,'这段时间还没有已有日记，没有编写总结。'):h(React.Fragment,null,
            h('p',null,'这是按日期合并的本机摘录，不等同模型概括。检查或修改后再保存。'),
            label('历史预览，可修改',h('textarea',{'aria-label':'历史总结预览',rows:16,maxLength:UI_JOURNAL_LIMITS.history,value:preview.body,onChange:e=>setPreview({...preview,body:e.target.value})})),
            h('details',null,h('summary',null,`来源日记 · ${preview.sources.length} 封`),...preview.sources.map(row=>h('p',{key:row.id},button(`${row.date} · ${row.title}`,()=>readLetter(row.id),busy),row.truncated&&h('small',null,' 预览已截取，完整正文保留在原日记中。')))),
            h('p',{className:'mochi-memory-muted'},historyDraft?'先保存或放弃正在编辑的历史，再使用这份预览。':'保存会替换当前历史正文，旧保存版本仍保留。'),button('用预览替换这本历史',savePreview,busy||!preview.body.trim()||!!historyDraft)),
          button('收起预览',()=>setPreview(null),busy))),
      state?.history.sourceEntryIds?.length>0&&h('details',null,h('summary',null,'这本历史来自哪些日记'),...state.history.sourceEntryIds.map(id=>{const row=state.entries.find(entry=>entry.id===id);return row?h('p',{key:id},button(`${row.date} · ${row.title}`,()=>readLetter(id),busy)):null;}))));
}

export const journalStyles=`
.mochi-journal-page{margin-top:16px}.mochi-journal-page h3{font-family:var(--dsw-font-serif,serif);font-size:19px;margin:8px 0}.mochi-journal-page label{display:flex;flex-direction:column;gap:5px;font-size:12px}.mochi-journal-actions{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:14px 0}.mochi-journal-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px;margin:20px 0}.mochi-memory-panel .mochi-journal-envelope{position:relative;overflow:hidden;text-align:left;min-height:180px;border-radius:10px;padding:18px;background:var(--dsw-alias-bg-layer-1,#fffdf8);box-shadow:0 3px 10px #403b3209;display:flex;flex-direction:column;gap:12px}.mochi-journal-envelope::after{content:"";position:absolute;bottom:0;left:0;right:0;height:32px;background:linear-gradient(14deg,transparent 48%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 52%),linear-gradient(-14deg,transparent 48%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 52%);pointer-events:none}.mochi-journal-envelope time{font-size:12px;color:var(--dsw-alias-label-secondary,#746c60);padding-bottom:8px;border-bottom:1px dashed var(--dsw-alias-border-l2,#d8d3c7);padding-right:38px}.mochi-journal-stamp{position:absolute;right:14px;top:12px;border:1px solid currentColor;border-radius:50%;width:26px;height:26px;text-align:center;line-height:26px;font-family:var(--dsw-font-serif,serif);opacity:.55}.mochi-journal-excerpt{font-size:12px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;line-height:1.7}.mochi-journal-envelope small{margin-top:auto;padding-bottom:18px;font-size:10px}.mochi-journal-letter,.mochi-journal-empty,.mochi-journal-range,.mochi-journal-settings{position:relative;border:1px solid var(--dsw-alias-border-l2,#d8d3c7);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fffdf8);padding:20px;margin:16px 0}.mochi-journal-letter::before,.mochi-journal-range::before{content:"";position:absolute;top:0;right:0;width:24px;height:24px;background:linear-gradient(225deg,var(--dsw-alias-bg-layer-2,#fffefa) 47%,var(--dsw-alias-border-l2,#d8d3c7) 50%,transparent 53%);pointer-events:none}.mochi-journal-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.95;font-size:14px;margin:22px 0}.mochi-journal-editor input,.mochi-journal-editor textarea,.mochi-journal-preview textarea{box-sizing:border-box;width:100%}.mochi-journal-editor textarea,.mochi-journal-preview textarea{font-size:14px;line-height:1.85;min-height:240px;resize:vertical}.mochi-journal-error{padding:12px;border-left:3px solid var(--dsw-alias-label-secondary,#746c60)}.mochi-journal-versions{margin-top:12px}.mochi-journal-page blockquote{margin:12px 0;padding-left:12px;border-left:1px dashed var(--dsw-alias-border-l2,#d8d3c7)}.mochi-memory-nav{margin-top:16px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8d3c7);display:flex;gap:8px;flex-wrap:wrap;padding-bottom:10px}.mochi-memory-nav [aria-selected=true]{background:var(--dsw-alias-bg-layer-3,#ece8df);font-weight:600}@media(max-width:560px){.mochi-journal-grid{grid-template-columns:1fr}.mochi-journal-letter,.mochi-journal-range,.mochi-journal-settings{padding:14px}}
`;
