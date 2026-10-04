/** Reuse the existing memory authority; never build a second memory database. */
export function installMemoryManagement(ctx, store, world, proactive = null) {
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  const snapshot=()=>({rows:store.listAll(),stats:store.stats(),learning:proactive?.snapshot()??null});
  const body=async request=>{
    const raw=await request.text();if(raw.length>12000)throw new Error('内容过长。');
    const input=JSON.parse(raw);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请求无效。');
    return input;
  };
  const checked=input=>{
    if(!Number.isSafeInteger(input.id)||input.id<1)throw new Error('记忆ID无效。');
    const row=store.listAll().find(row=>row.id===input.id);
    if(!row)throw new Error('这条记忆已被修改或忘记，请刷新后再试。');
    if(input.expected!==row.content)throw new Error('记忆已经变化，请刷新后再修改。');
    return row;
  };
  const content=value=>{
    if(typeof value!=='string'||!value.trim()||value.length>2000)throw new Error('记忆内容需要1–2000字。');
    return value.trim();
  };
  const register=(path,method,action)=>ctx.connection.fetch.register({path:'/api/mochi-memory'+path,methods:[method],requestBody:'buffered',fetch:async request=>{
    try{return json(await action(request));}catch(error){return json({error:String(error.message??error)},400);}
  }});
  return [
    register('/state','GET',snapshot),
    register('/save','POST',async request=>{
      const input=await body(request),text=content(input.content);
      if(input.id!==undefined){
        const prior=checked(input);
        store.supersede(prior.id,{content:text,summary:'',source:'explicit_request'});
        proactive?.dismissMemory(prior.id);
        if(prior.kind==='convention'){world.removeConvention(prior.summary||prior.content);world.setConvention(text);}
      }else{
        if(!['preference','task_fact','org_knowledge','convention'].includes(input.kind))throw new Error('请选择记忆类型。');
        store.note({kind:input.kind,content:text,source:'explicit_request'});
        if(input.kind==='convention')world.setConvention(text);
      }
      return snapshot();
    }),
    register('/pin','POST',async request=>{const input=await body(request);const row=checked(input);if(typeof input.pinned!=='boolean')throw new Error('固定状态无效。');store.pin(row.id,input.pinned);return snapshot();}),
    register('/forget','POST',async request=>{
      const input=await body(request),row=checked(input);
      if(input.confirmed!==true)throw new Error('请确认要忘记的内容。');
      if(row.kind==='convention')world.removeConvention(row.summary||row.content);
      store.forget(row.id);proactive?.dismissMemory(row.id);return snapshot();
    }),
    ...(proactive?[
      register('/learning','POST',async request=>{proactive.configure((await body(request)).enabled);return snapshot();}),
      register('/dismiss-observation','POST',async request=>{proactive.dismiss((await body(request)).key);return snapshot();}),
    ]:[]),
  ];
}
