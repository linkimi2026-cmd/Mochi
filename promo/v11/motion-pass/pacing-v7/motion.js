/* Film-only additive camera rig. Product DOM, video rate and source data stay intact. */
window.MochiPacing={apply(config){
 const stage=document.querySelector('#film'),tl=Object.values(window.__timelines)[0];
 const rig=document.createElement('div');rig.id='editorial-camera';
 Object.assign(rig.style,{position:'absolute',inset:'0',transformOrigin:'0 0',pointerEvents:'none'});
 const elements=[...new Set(config.targets.flatMap(s=>[...stage.querySelectorAll(s)]))];
 stage.insertBefore(rig,elements[0]);elements.forEach(e=>rig.append(e));
 const captions=document.createElement('div');
 Object.assign(captions.style,{position:'absolute',inset:'0',pointerEvents:'none'});
 const captionNodes=[...stage.children].filter(e=>e.matches('.copy,.copy-group,.headline,h1,h2,#hint,#arrival,#colors-sub'));
 stage.append(captions);captionNodes.forEach(e=>captions.append(e));
 const neutral={scale:1,x:0,y:0};
 function move(at,duration,pose){tl.to(rig,{...pose,duration,ease:'power2.inOut'},at)}
 const report=[];
 for(const [start,end,targets,purpose]of config.windows){
  const poses=targets.map(([scale,cx,cy])=>({scale,x:1280-cx*scale,y:720-cy*scale}));
  const steps=[...poses,neutral],step=(end-start)/steps.length;
  // Each stop lasts <=1.2 s. The remainder is a smooth, purposeful camera move.
  const travel=Math.max(.55,step-1.2);
  steps.forEach((pose,i)=>move(start+i*step,Math.min(travel,step),pose));
  // The editorial headline clears the close-up instead of covering native fields.
  tl.to(captions,{opacity:0,duration:.25},start);
  tl.to(captions,{opacity:1,duration:.25},end-.25);
  report.push({start,end,purpose,maxDesignedHold:Math.max(0,step-travel),targets});
 }
 // Small perspective paper fields, behind the UI. They move through space, not over text.
 const field=document.createElement('div');field.id='editorial-paper-field';
 Object.assign(field.style,{position:'absolute',inset:'0',overflow:'hidden',pointerEvents:'none',perspective:'2200px'});
 stage.insertBefore(field,stage.firstChild);
 const colors=['#dbe5cd','#efe0c4','#d6e5df'];
 for(let i=0;i<3;i++){
  const paper=document.createElement('div');
  Object.assign(paper.style,{position:'absolute',width:'820px',height:'1140px',left:(i===1?2160:-650)+'px',top:(i*470-540)+'px',background:colors[i],opacity:'.68',boxShadow:'30px 40px 0 #fffaf550',transformOrigin:'50% 50%'});
  field.append(paper);tl.set(paper,{rotation:i%2?17:-24,rotationY:i%2?-24:21},0);
  for(const [k,w]of config.windows.entries())tl.to(paper,{x:(k%2?1:-1)*(110+i*25),y:((k+i)%3-1)*150,rotation:(k%2?1:-1)*(16+i*3),duration:1.1,ease:'power2.inOut'},w[0]+i*.07);
 }
 // Endpoint identity is required by the already-rendered inter-chapter bridges.
 const duration=Number(stage.dataset.duration||tl.duration());
 tl.fromTo(field,{opacity:0},{opacity:1,duration:.5,immediateRender:false},1.25);
 tl.to(field,{opacity:0,duration:.4},duration-1.8);
 if(config.id==='model'){
  // The model remains the original iframe with its existing deterministic interaction clock.
  const moves=[
   [10.5,1.05,{x:65,y:190,scale:1.68}],
   [12.65,.85,{x:220,y:220,scale:1.48}],
   [14.65,.8,{x:90,y:180,scale:1.62}],
   [16.65,.85,{x:130,y:155,scale:1.5}],
   [18.7,.85,{x:240,y:155,scale:1.45}],
   [20.65,.9,{x:-400,y:165,scale:1.7}],
   [22.55,.55,{x:272,y:230,scale:1.4}],
  ];
  // The native model clock seeks this GSAP camera before calculating screen cursor positions.
  // This also works when the renderer suppresses timeline callbacks during random-access seeks.
  const camera=gsap.timeline({paused:true});let previous={x:272,y:230,scale:1.4};
  moves.forEach(([at,duration,pose])=>{camera.fromTo('#model',previous,{...pose,duration,ease:'power2.inOut',immediateRender:false},at);previous=pose});
  window.updateMochiModelCamera=t=>{if(t>=10.5&&t<23.15)camera.seek(t)};
  kinetic('拖动，一个切点。',11.9,14.5,'left');
  kinetic('看见，几何关系。',14.6,17.15,'right');
  kinetic('改变参数，继续探索。',17.2,20.35,'left');
  kinetic('再展开，为什么。',20.4,22.8,'right');
 }
 function kinetic(text,start,end,align){
  const el=document.createElement('div');el.className='pacing-type';
  Object.assign(el.style,{position:'absolute',left:align==='left'?'180px':'auto',right:align==='right'?'160px':'auto',top:'28px',height:'95px',font:'700 68px/1.15 MoSans',letterSpacing:'-3px',overflow:'hidden',whiteSpace:'nowrap',pointerEvents:'none',opacity:'0'});
  for(const char of text){const span=document.createElement('span');span.className='glyph';span.textContent=char;span.style.display='inline-block';el.append(span)}
  stage.append(el);tl.set(el,{opacity:1},start);
  tl.fromTo(el.children,{y:100,rotation:8,opacity:0},{y:0,rotation:0,opacity:1,stagger:.022,duration:.55,ease:'power3.out',immediateRender:false},start);
  tl.to(el,{x:align==='left'?80:-80,duration:.65,ease:'power2.inOut'},end-1.15);
  tl.to(el.children,{y:-110,rotation:-5,opacity:0,stagger:.016,duration:.35,ease:'power2.in'},end-.4);
 }
 window.pacingEvidence={chapter:config.id,windows:report,playbackRate:1};
}};
