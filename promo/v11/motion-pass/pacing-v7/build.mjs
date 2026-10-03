import {readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const dir=dirname(fileURLToPath(import.meta.url)),v11=resolve(dir,'../..');
// Each beat names a real information target. Scale is spatial, never playback speed.
const chapters=[
 {id:'opening',source:'opening-chapter',targets:['#home-camera','#scene-camera','#example-camera','.film-pointer-layer'],windows:[
  [6.2,9.2,[[1.18,890,560],[1.2,960,710]],'场景预设：入口到示例'],
  [12.2,15.8,[[1.18,1220,630],[1.22,1230,910]],'需求示例：列表到输入框'],
  [1.15,3.25,[[1.15,1240,590]],'首页问候进入工作入口']]},
 {id:'team',source:'team-dialogue',targets:['#roster','#plan-camera','#deck-camera','#characters','.film-pointer-layer'],windows:[
  [1.4,4,[[1.2,1170,910]],'Agent 角色名单'],
  [7,8.4,[[1.12,810,710]],'教案内容'],
  [15.6,18.05,[[1.25,1730,720]],'课件成员回应'],
  [20.55,23.1,[[1.15,1100,780],[1.15,1450,780]],'四种原生配色'],
  [13.1,15.55,[[1.16,1620,730]],'课件会话的操作落点']]},
 {id:'teaching',source:'teaching-chapter',targets:['#cover','#process','#old-page','#new-page','#gallery'],windows:[
  [1.75,3.65,[[1.16,1080,760]],'课件封面与内容'],
  [8.9,10.6,[[1.18,1330,800]],'可编辑图表'],
  [13.8,19.65,[[1.28,610,790],[1.27,1260,780],[1.3,1940,770]],'课件、练习、成绩图表依次成为主体']]},
 {id:'delivery',source:'delivery-chapter',targets:['.native','#file','#sent-label','#received-label'],windows:[
  [2.65,4.05,[[1.12,1850,740]],'双方确认'],
  [7.7,9.6,[[1.24,1870,680]],'教室端送达'],
  [10.4,15.2,[[1.25,630,720],[1.13,1310,740]],'教师回执到双端关系']]},
 {id:'model',source:'model-chapter',targets:['#request','#sent','#process'],windows:[
  [4.25,5.8,[[1.13,1400,770]],'真实请求已发送']]},
 {id:'mailbox',source:'mailbox-chapter',targets:['#popup','#mailbox'],windows:[
  [8.3,13.6,[[1.2,870,750],[1.22,850,900]],'来信类别到消息状态'],
  [15,16.7,[[1.12,1220,760]],'保留来处的信箱']]},
 {id:'students',source:'student-chapter',targets:['.card'],windows:[
  [1.65,6.8,[[1.24,1270,640],[1.24,1260,875]],'预约：谁、何时、带什么'],
  [8.05,12.8,[[1.21,1260,670],[1.24,1270,920]],'请求到老师确认'],
  [16.45,18.8,[[1.2,1790,820]],'教室收到回信'],
  [20.65,23.8,[[1.16,710,770],[1.17,1780,850]],'提问和补做两种状态'],
  [25.55,28.1,[[1.22,1720,720]],'叫人：时间、地点、材料'],
  [33.4,35.8,[[1.18,1700,725]],'已看到状态'],
  [39.1,42.8,[[1.22,1730,760],[1.12,1140,820]],'回执内容与两端关系'],
  [44.6,48.65,[[1.17,660,780],[1.16,1770,800]],'预约到通知，连接同一校园']]},
 {id:'query',source:'motion-pass/native-query',targets:['#send','#process','#result','#close'],windows:[
  [8.3,12.05,[[1.19,1340,660],[1.2,1340,845]],'查找工具与执行进展'],
  [14.6,18.9,[[1.18,1450,620],[1.2,1450,845]],'原对话中的查询结果'],
  [21.4,29.5,[[1.23,1240,620],[1.25,1240,830],[1.16,1270,860]],'学生、目的地、状态，三处真实字段'],
  [2.55,5.1,[[1.17,1400,900]],'查人输入与发送入口']]},
 {id:'collaboration',source:'collaboration-chapter',targets:['.native','#states','#label','#reply-label','#find-note'],windows:[
  [1.55,3.4,[[1.14,810,700]],'放行前确认'],
  [10.7,12.6,[[1.2,1830,740]],'返班闭环'],
  [17.3,19.15,[[1.17,1760,745]],'问询回应'],
  [22.95,24,[[1.13,1690,760]],'委托接办'],
  [27.55,28.95,[[1.13,1700,760]],'寻物回应，继续查找']]},
];
const common=readFileSync(resolve(dir,'motion.js'),'utf8');
const manifest=[];
for(const c of chapters){
 const folder=resolve(dir,c.id);mkdirSync(folder,{recursive:true});
 if(!existsSync(resolve(folder,'assets')))symlinkSync(relative(folder,resolve(v11,c.source,'assets')),resolve(folder,'assets'));
 let html=readFileSync(resolve(v11,c.source,'index.html'),'utf8');
 manifest.push({chapter:c.id,source:c.source+'/index.html',sha256:createHash('sha256').update(html).digest('hex')});
 html=html.replaceAll('font-family:Serif','font-family:MoSerif');
 if(c.id==='query')html=html.replace('data-duration="42" data-fps','data-duration="30.65" data-fps')
  .replace(/<video id="pending"[^>]*><\/video>/,'<div id="pending"></div>')
  .replace('data-start="20" data-duration="12"','data-start="20" data-duration="10.65"');
 if(c.id==='model'){
  if(!html.includes("tl.to('#model',{keyframes:")||!html.includes('const state=frame.contentWindow.renderMochiModel(modelTime);'))throw Error('Model source boundary changed; review adapter before rebuilding');
  html=html.replace(/tl\.to\('#model',\{keyframes:\[.*?\]\},10\.5\);/s,'');
  html=html.replace("title('#title-b',10,22.6);","title('#title-b',10,11.6);");
  html=html.replace('const state=frame.contentWindow.renderMochiModel(modelTime);','window.updateMochiModelCamera?.(modelTime+10.5);\n const state=frame.contentWindow.renderMochiModel(modelTime);');
 }
 html=html.replace('</body>',`<script>${common}\nMochiPacing.apply(${JSON.stringify(c)});</script></body>`);
 writeFileSync(resolve(folder,'index.html'),html);
}
writeFileSync(resolve(dir,'chapters.json'),JSON.stringify(chapters,null,2)+'\n');
writeFileSync(resolve(dir,'source-manifest.json'),JSON.stringify({method:'Original chapter HTML and linked original assets; added film camera/type choreography only',sources:manifest},null,2)+'\n');
console.log('Prepared',chapters.length,'isolated chapter compositions');
