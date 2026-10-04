import {MochiLanService} from '/Applications/Mochi.app/Contents/Resources/mochi/plugins/mochi-lan/lan-service.mjs';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const base=resolve('promo/v9/private.nosync'), root=join(base,'home'), classroomRoot=join(base,'classroom-home','mochi-lan');
const teacher=new MochiLanService({dataRoot:join(root,'mochi-lan'),bindHost:'127.0.0.1',port:49331,discoveryEnabled:false,lockedRole:'teacher',identity:{schoolId:'mochi-promo-demo',displayName:'林老师（演示）'}});
const classroom=new MochiLanService({dataRoot:classroomRoot,bindHost:'127.0.0.1',port:49332,discoveryEnabled:false,lockedRole:'classroom',identity:{schoolId:'mochi-promo-demo',classId:'demo-class-1',displayName:'高一（1）班（演示）'}});
await teacher.start();await classroom.start();
const auth=(s,a)=>s.authorize(a,'connection-direct');
if(!teacher.snapshot().peers.length){
 const probe=await teacher.probeCandidate({address:{host:'127.0.0.1',port:49332}});
 const request=await teacher.requestPairing({...probe,pairingCode:classroom.snapshot().pairingCode.code,authorization:auth(teacher,'request-pairing')});
 await classroom.acceptPairing({requestId:request.requestId,authorization:auth(classroom,'accept-pairing')});
}
const targetEndpointId=teacher.snapshot().identity.endpointId;
const requests=[
 {student:'小林（演示）',seat:12,kind:'appointment',material:'数学随堂练习',position:'第 3 题',topic:'函数图像错题答疑',slot:'今天 16:30'},
 {student:'小陈（演示）',seat:8,kind:'question',material:'英语阅读练习',position:'第 2 题',topic:'想请教长句理解'},
 {student:'小周（演示）',seat:21,kind:'makeup',material:'语文课堂练习',position:'第 1 页',topic:'申请课后补做练习'}
];
const receipts=[];
for(const request of requests) receipts.push(await classroom.sendRequest({targetEndpointId,request,body:`${request.student}：${request.topic}。${request.slot??'请老师安排时间。'}`,authorization:auth(classroom,'send-request')}));
const yaml=createRequire('/Applications/Mochi.app/Contents/Resources/mochi/node_modules/@deepseek-ai/dsh/package.json')('yaml');
const patch=join(root,'profiles/mochi-web/cordis.patch.yml'),doc=yaml.parseDocument(readFileSync(patch,'utf8'));
function update(node){if(yaml.isSeq(node))for(const row of node.items)update(row);if(yaml.isMap(node)){if(node.get('id')==='mochi-lan'){const c=node.get('config',true);c.set('port',49331);c.set('bindHost','127.0.0.1');c.set('discoveryEnabled',false);}for(const pair of node.items)update(pair.value);}}
update(doc.contents);writeFileSync(patch,String(doc));
await teacher.stop();
writeFileSync(resolve('promo/v9/evidence/lan-demo-setup.json'),JSON.stringify({syntheticData:true,transport:'real signed loopback LAN service',teacherPort:49331,classroomPort:49332,requests,receipts},null,2));
console.log('READY: three synthetic student requests delivered by real signed transport; classroom receiver stays live at 49332.');
process.on('SIGTERM',async()=>{await classroom.stop();process.exit(0);});
