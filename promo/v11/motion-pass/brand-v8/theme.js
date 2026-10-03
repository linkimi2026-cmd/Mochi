/* Editorial stage colors only: never recolor native DOM, video, images or iframe content. */
window.MochiBrand={apply(config){
 const {id,palette:p,next,palettes}=config,stage=document.querySelector('#film'),tl=Object.values(window.__timelines)[0],duration=Number(stage.dataset.duration);
 const ink=p.id==='caramel'?p.glyph:p.eyes;
 // Preserve inherited native foreground colors before changing the editorial stage.
 stage.querySelectorAll('.native,#file,#grade-native').forEach(el=>{el.style.color=getComputedStyle(el).color});
 if(['delivery','mailbox','collaboration'].includes(id)){const light=stage.querySelector('#light');if(light)light.style.background=`radial-gradient(ellipse at 70% 25%,${p.glyph}18,transparent 60%)`;}
 stage.style.background=p.body;stage.style.color=ink;
 stage.dataset.brandPalette=p.id;
 const css=document.createElement('style');css.textContent=`
 #film .paper-world .paper-room{background:${p.body}!important}
 #film #world,#film #atmosphere{background:none!important}
 #film .copy,#film .copy-group,#film .headline,#film .pacing-type,#film #words,#film #chapter,#film #page-state,#film #labels,#film #colors-sub,#film .type,#film .type p{color:${ink}}
 #film #source-note,#film #note,#film #folio{color:${p.case};background:${p.glyph}e6;border-radius:8px;padding:8px 14px}
 #film #characters .character{background:radial-gradient(ellipse at 50% 34%,#f3f1df 0%,#f3f1df99 32%,transparent 67%);border-radius:50%}
 #brand-mark{position:absolute;right:100px;top:64px;width:126px;height:126px;z-index:5;opacity:0;pointer-events:none}
 `;document.head.append(css);
 const field=document.querySelector('#editorial-paper-field');
 if(field)[...field.children].forEach((el,i)=>{el.style.background=i===1?p.glyph:palettes[(palettes.findIndex(x=>x.id===p.id)+i+1)%4]?.body||p.glyph;el.style.opacity='.42'});
 if(id==='daily'){
  // Discrete memory and automation sections gain a new palette through moving paper.
  const swaps=[[0,'sage'],[8,'cream'],[14,'peach'],[22,'cream'],[28,'sage'],[36,'peach'],[42,'cream']];
  for(const [at,key]of swaps){const theme=palettes.find(x=>x.id===key);tl.to(stage,{backgroundColor:theme.body,duration:.65,ease:'power2.inOut'},at)}
 }
 if(next){
  const wipe=document.createElement('div');wipe.id='brand-color-wipe';
  Object.assign(wipe.style,{position:'absolute',inset:'-12%',background:next.body,pointerEvents:'none'});
  stage.insertBefore(wipe,stage.firstChild);
  const n=Number(id.split('-')[1]);
  if(n%3===0){tl.fromTo(wipe,{clipPath:'circle(0% at 74% 70%)'},{clipPath:'circle(145% at 74% 70%)',duration:duration*.64,ease:'power3.inOut',immediateRender:false},duration*.05)}
  else if(n%3===1){tl.fromTo(wipe,{xPercent:115,rotation:-8},{xPercent:0,rotation:0,duration:duration*.64,ease:'power3.inOut',immediateRender:false},duration*.05)}
  else{tl.fromTo(wipe,{yPercent:115,rotation:8},{yPercent:0,rotation:0,duration:duration*.64,ease:'power3.inOut',immediateRender:false},duration*.05)}
  const logo=document.createElement('img');logo.id='brand-mark';logo.src='assets/brand.svg';logo.alt='Mochi';if(n===3){logo.style.left='100px';logo.style.right='auto'}stage.append(logo);
  tl.fromTo(logo,{y:24,scale:.7,opacity:0},{y:0,scale:1,opacity:1,duration:.35,ease:'power3.out',immediateRender:false},duration*.26);
  tl.to(logo,{y:-24,opacity:0,duration:.28},duration*.60);
  tl.to('#words',{color:next.id==='caramel'?next.glyph:next.eyes,duration:.35},duration*.25);
 }
 window.brandEvidence={id,palette:p.id,background:p.body,next:next?.id||null,productUiModified:false};
}};
