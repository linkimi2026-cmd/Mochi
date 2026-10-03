import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{execFileSync}from'node:child_process';import{resolve,dirname}from'node:path';import{fileURLToPath}from'node:url';
const dir=dirname(fileURLToPath(import.meta.url)),parent=resolve(dir,'..'),media=resolve(dir,'media');mkdirSync(media,{recursive:true});
const plan=JSON.parse(readFileSync(resolve(dir,'../pacing-v7/plan.json')));
const enc=['-an','-c:v','h264_videotoolbox','-allow_sw','1','-profile:v','high','-level:v','5.2','-b:v','22000000','-pix_fmt','yuv420p','-g','120','-video_track_timescale','15360'];
const ff=a=>execFileSync('ffmpeg',['-v','error','-nostdin',...a],{stdio:'inherit'});
const refreshArg=process.argv.find(a=>a.startsWith('--refresh='));
const refresh=refreshArg?new Set(refreshArg.split('=')[1].split(',').map(Number)):null;
if(refresh&&[...refresh].some(i=>!Number.isInteger(i)||i<0||i>7))throw Error('refresh requires chapter indices 0–7');
const needs=i=>!refresh||refresh.has(i);
const bridgeNeeds=i=>needs(i)||needs(i+1);
const movie=id=>resolve(dir,id,'output/video.mp4');
function join(a,b,alen,blen,out,skipB=0,overlap=0){
 const norm='setpts=PTS-STARTPTS,setsar=1,fps=120,settb=1/120';
 const filter=`[0:v]trim=duration=${alen},${norm}[a];[1:v]trim=duration=${blen},${norm}[b];[a][b]${overlap?`xfade=transition=slideleft:duration=${overlap}:offset=${alen-overlap}`:'concat=n=2:v=1:a=0'},format=yuv420p[v]`;
 ff(['-i',a,'-ss',String(skipB),'-i',b,'-filter_complex',filter,'-map','[v]','-t',String(alen+blen-overlap),...enc,'-y',out]);
}
if(process.argv.includes('--sources')){
 if(needs(0))join(movie('greeting'),movie('opening'),8,14,resolve(media,'opening.mp4'),4);
 // The existing 22 s cut interrupted the paper flight. Keep that flight over the incoming scene.
 if(needs(2))join(movie('teaching'),movie('delivery'),25,16,resolve(media,'teaching-delivery.mp4'),0,3);
 if(needs(6))join(movie('query'),movie('collaboration'),30.65,30,resolve(media,'query-collaboration.mp4'),0,.65);
 if(needs(7))join(movie('daily'),movie('ending'),48,8,resolve(media,'daily-ending.mp4'),0,.6);
 const sources=[resolve(media,'opening.mp4'),movie('team'),resolve(media,'teaching-delivery.mp4'),movie('model'),movie('mailbox'),movie('students'),resolve(media,'query-collaboration.mp4'),resolve(media,'daily-ending.mp4')];
 plan.chapters.forEach((c,i)=>{c.source=sources[i];c.start=0});
 plan.chapters[0].name='Mo问候、校园工作伙伴定位与需求';plan.chapters[7].duration=55.4;plan.duration=299.35;
 writeFileSync(resolve(dir,'plan.json'),JSON.stringify(plan,null,2)+'\n');
 for(let i=0;i<7;i++){
  if(!bridgeNeeds(i))continue;
  const assets=resolve(dir,'bridges',String(i),'assets'),seconds=plan.bridgeDurations[i];
  for(const [side,c,at]of[['out',plan.chapters[i],plan.chapters[i].duration-1.2],['in',plan.chapters[i+1],0]]){
   ff(['-ss',String(at),'-i',c.source,'-t','1.2','-vf','fps=120,setsar=1',...enc,'-y',resolve(assets,side+'-short.mp4')]);
   ff(['-i',resolve(assets,side+'-short.mp4'),'-vf',`tpad=${side==='in'?'start':'stop'}_mode=clone:${side==='in'?'start':'stop'}_duration=${seconds-1.2},fps=120`,'-t',String(seconds),...enc,'-y',resolve(assets,side+'.mp4')]);
  }
 }
 console.log('Selected source sequences and bridge handles ready');
}
if(process.argv.includes('--final')){
 const next=JSON.parse(readFileSync(resolve(dir,'plan.json'))),parts=[],chapters=[];let cursor=0;
 for(const [i,c]of next.chapters.entries()){
  const skip=i?1.2:0,duration=c.duration-skip-(i<7?1.2:0),body=resolve(media,`body-${i}.mp4`);
  if(needs(i))ff(['-ss',String(skip),'-i',c.source,'-t',String(duration),'-vf','fps=120,setsar=1',...enc,'-y',body]);
  parts.push(body);chapters.push({type:'chapter',name:c.name,start:cursor,duration,source:c.source,sourceStart:skip});cursor+=duration;
  if(i<7){const duration=next.bridgeDurations[i],source=resolve(dir,'bridges',String(i),'output/video.mp4'),bridge=resolve(media,`bridge-${i}.mp4`);if(bridgeNeeds(i))ff(['-i',source,'-t',String(duration),'-vf','fps=120,setsar=1',...enc,'-y',bridge]);parts.push(bridge);chapters.push({type:'mo-handoff',name:`Mo: ${c.name} → ${next.chapters[i+1].name}`,start:cursor,duration,source});cursor+=duration}
 }
 const concat=resolve(media,'concat.txt');writeFileSync(concat,parts.map(p=>`file '${p}'`).join('\n'));
 const output=resolve(media,'picture.mp4');
 ff(['-f','concat','-safe','0','-i',concat,'-c:v','copy','-an','-movflags','+faststart','-y',output]);
 writeFileSync(resolve(parent,'timeline.json'),JSON.stringify({edition:8,width:2560,height:1440,fps:120,duration:cursor,output,chapters},null,2)+'\n');console.log(output,cursor);
}
