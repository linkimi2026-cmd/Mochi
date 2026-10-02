import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const run=resolve('promo/v11/feature-proof/private.nosync/movement-'+new Date().toISOString().replaceAll(':','-'));mkdirSync(run,{recursive:true});process.env.MOCHI_CAMPUS_SESSION_FILE=resolve(run,'session.json');
const {CampusConnection,campusToken}=await import('../../../plugins/mochi-campus/connection.mjs');const {apply}=await import('../../../plugins/mochi-campus/index.mjs');
const origin='http://127.0.0.1:49340';const health=await(await fetch(origin+'/api/health')).json();if(health.environment!=='demo')throw Error('Demo only');
const approvals=[],steps=[];
async function account(username,password){const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:origin},body:JSON.stringify({username,password})});const d=await r.json();if(!r.ok)throw Error(d.code);const connection=new CampusConnection(origin);connection.activate(campusToken(r.headers.get('set-cookie')),d.user);const tools=new Map();apply({tools:{register:t=>tools.set(t.name,t)},get:key=>key==='approval'?{request:async req=>{approvals.push({account:d.user.name,tool:req.toolName,reason:req.reason,decision:'allowed-once',source:'Authorized isolated demonstration harness; not a human click recording'});return'allowed-once'}}:undefined},connection);const exec={agent:{session:{}},callId:'movement-demo-'+username};return{user:d.user,call:async(name,args={})=>{const result=await tools.get(name).execute(args,exec);steps.push({account:d.user.name,tool:name,args,result});writeFileSync(resolve(run,'steps.json'),JSON.stringify({steps,approvals},null,2));return result},read:path=>connection.request(path,exec)}}
const teacher=await account('banzhuren',process.env.MOCHI_DEMO_TEACHER_PASSWORD),dorm=await account('sushe',process.env.MOCHI_DEMO_DORM_PASSWORD);
const directory=await teacher.call('jxl_student_directory_search',{keyword:'DEMO003',limit:10});
const students=directory.result.students||directory.result.items||[];if(students.length!==1)throw Error('Expected one synthetic DEMO003 student');const student=students[0];
const list=await teacher.call('jxl_movement_request_list');let request=list.result.items.find(r=>r.studentId===student.id&&r.status==='PENDING'&&r.destination==='DORMITORY');
if(!request){const created=await teacher.call('jxl_movement_request_create',{studentId:student.id,destination:'DORMITORY',reasonCategory:'取物',expectedArrivalMinutes:10,idempotencyKey:randomUUID()});request=created.result.request;}
const approved=await teacher.call('jxl_movement_request_decide',{reference:request.publicReference,action:'approve',expectedVersion:request.version,idempotencyKey:randomUUID()});
const reference=approved.result.movementReference;if(!reference)throw Error('No official movement after approval');
for(const [actor,action]of [[dorm,'arrive'],[dorm,'leave'],[teacher,'confirm-return']]){const state=await actor.read('/api/movements/'+encodeURIComponent(reference));const movement=state.result.movement??state.result;await actor.call('jxl_movement_transition',{reference,action,expectedVersion:movement.version,idempotencyKey:randomUUID()});}
const final=await teacher.read('/api/movements/'+encodeURIComponent(reference));
writeFileSync('promo/v11/feature-proof/movement-result.json',JSON.stringify({run,actualProductTools:true,actualLocalDemoBackend:true,student,reference,steps,approvals,final},null,2)+'\n');console.log(JSON.stringify({run,reference,status:final.result.movement?.status??final.result.status}));
