import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const run=resolve('promo/v11/feature-proof/private.nosync/a2a-'+new Date().toISOString().replaceAll(':','-'));mkdirSync(run,{recursive:true});
process.env.MOCHI_CAMPUS_SESSION_FILE=resolve(run,'campus-session.json');
const {CampusConnection,campusToken}=await import('../../../plugins/mochi-campus/connection.mjs');
const {apply}=await import('../../../plugins/mochi-dispatch/index.mjs');
const {createStore,openStore}=await import('../../../plugins/mochi-dispatch/store.mjs');
const origin='http://127.0.0.1:49340';const health=await(await fetch(origin+'/api/health')).json();if(health.environment!=='demo')throw Error('Demo only');
const approvals=[];
async function account(username,password){
 const response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:origin},body:JSON.stringify({username,password})});const data=await response.json();if(!response.ok)throw Error(username+': '+data.code);
 const connection=new CampusConnection(origin);connection.activate(campusToken(response.headers.get('set-cookie')),data.user);
 const tools=new Map(),db=openStore(resolve(run,username+'.sqlite'));
 apply({tools:{register:t=>tools.set(t.name,t)},get:key=>key==='approval'?{request:async req=>{approvals.push({account:data.user.name,tool:req.toolName,reason:req.reason,decision:'allowed-once',source:'User-authorized isolated demonstration harness; not a recording of human clicking'});return'allowed-once'}}:undefined},connection,createStore(db));
 const exec={agent:{session:{}},callId:'promo-'+username};return{user:data.user,db,call:(name,args={})=>tools.get(name).execute(args,exec)};
}
const teacher=await account('banzhuren',process.env.MOCHI_DEMO_TEACHER_PASSWORD),peer=await account('renke',process.env.MOCHI_DEMO_PEER_PASSWORD);
const results=[];
try{for(const [tool,args,note] of [
 ['mochi_ask',{goal:'明天下午可以一起核对一次函数课件吗？'},'可以，明天下午一起核对课件。'],
 ['mochi_request',{goal:'请帮忙检查一次函数练习第二题的表述。'},'我来检查第二题，修改后再发给你确认。'],
 ['mochi_find',{item:'一次函数磁吸坐标板（演示）'},'我会先查看数学备课室，找到后再联系你。']
]){
 const sent=await teacher.call(tool,{peerName:peer.user.name,...args});
 const inbox=await peer.call('mochi_tasks');const pending=inbox['等我回应'];const match=pending.find(t=>JSON.stringify(t).includes(args.goal||args.item));if(!match)throw Error('No matching actual inbound task');
 writeFileSync(resolve(run,tool+'-received.json'),JSON.stringify({sent,inbox},null,2));
 const response=await peer.call('mochi_respond',{taskId:match.taskId,decision:'approve',note});const final=await teacher.call('mochi_tasks');
 results.push({tool,args,sent,response,final});
}
writeFileSync(resolve(run,'results.json'),JSON.stringify({results,approvals},null,2));
writeFileSync('promo/v11/feature-proof/a2a-result.json',JSON.stringify({run,actualProductTools:true,actualLocalDemoBackend:true,accounts:[teacher.user.name,peer.user.name],approvals:approvals.map(({account,tool,decision,source})=>({account,tool,decision,source})),results},null,2)+'\n');console.log(JSON.stringify({run,completed:results.length}));
}finally{teacher.db.close();peer.db.close()}
