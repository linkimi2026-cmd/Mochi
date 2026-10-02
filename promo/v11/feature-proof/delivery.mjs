import {MochiLanService} from '../../../plugins/mochi-lan/lan-service.mjs';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url)),run=resolve(dir,'private.nosync',new Date().toISOString().replaceAll(':','-'));
mkdirSync(run,{recursive:true});
const source=resolve(dir,'../../v9/demo-workspace/pptx-output/presentation.pptx');
const create=(role,displayName)=>new MochiLanService({dataRoot:resolve(run,role),allowedSourceRoots:[dirname(source)],bindHost:'127.0.0.1',port:0,discoveryEnabled:false,lockedRole:role,identity:{schoolId:'mochi-promo-proof',displayName,...(role==='classroom'?{classId:'demo-class-1'}:{})}});
const teacher=create('teacher','林老师（演示）'),classroom=create('classroom','高一（1）班（演示）');
const auth=(service,action)=>service.authorize(action,'connection-direct');
const save=name=>writeFileSync(resolve(run,name+'.json'),JSON.stringify({teacher:teacher.snapshot(),classroom:classroom.snapshot()},null,2)+'\n');
try{
 await teacher.start();await classroom.start();save('01-before-pair');
 const target=classroom.snapshot();const probe=await teacher.probeCandidate({address:{host:'127.0.0.1',port:target.http.port}});
 const request=await teacher.requestPairing({...probe,pairingCode:target.pairingCode.code,authorization:auth(teacher,'request-pairing')});save('02-pair-request');
 await classroom.acceptPairing({requestId:request.requestId,authorization:auth(classroom,'accept-pairing')});save('03-paired');
 const sent=await teacher.sendFile({targetEndpointId:target.identity.endpointId,sourcePath:source,body:'一次函数课件已送达，请打开课堂演示。',authorization:auth(teacher,'send-file')});save('04-received');
 const received=classroom.snapshot().inbox.find(row=>row.attachment?.filename==='presentation.pptx');if(!received)throw Error('Missing actual receiver attachment');
 await classroom.markSeen({messageId:received.messageId,authorization:auth(classroom,'mark-seen')});save('05-receipt');
 const opened=await classroom.openReceivedPresentation({messageId:received.messageId,authorization:auth(classroom,'open-presentation')});save('06-wps-request');
 writeFileSync(resolve(dir,'delivery-result.json'),JSON.stringify({run,syntheticData:true,actualSignedTransport:true,sourceSha256:createHash('sha256').update(readFileSync(source)).digest('hex'),paired:teacher.snapshot().peers.length===1,delivery:sent,receiverSeen:Boolean(classroom.snapshot().inbox.find(r=>r.messageId===received.messageId)?.seenAt),openResult:opened,wpsWindowVisuallyVerified:false},null,2)+'\n');
 console.log(JSON.stringify({run,openResult:opened}));
}finally{await teacher.stop();await classroom.stop()}
