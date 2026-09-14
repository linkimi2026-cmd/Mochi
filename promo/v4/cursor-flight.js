function addCursorFlights(moves) {
  const ns='http://www.w3.org/2000/svg', layer=document.getElementById('thread-layer');
  let previous=null;
  moves.sort((a,b)=>a.t-b.t).forEach((m,i)=>{
    const start=previous||{x:m.x+140,y:m.y+80}; previous=m;
    const dx=m.x-start.x,dy=m.y-start.y;
    const d=`M ${start.x} ${start.y} C ${start.x+dx*.45} ${start.y+dy*.1} ${start.x+dx*.65} ${m.y-dy*.1} ${m.x} ${m.y}`;
    const group=document.createElementNS(ns,'g'),defs=document.createElementNS(ns,'defs'),mask=document.createElementNS(ns,'mask'),reveal=document.createElementNS(ns,'path'),trail=document.createElementNS(ns,'path');
    mask.id=`cursor-trail-mask-${i}`;mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');mask.setAttribute('width','1920');mask.setAttribute('height','1080');
    reveal.setAttribute('d',d);reveal.setAttribute('pathLength','1');reveal.setAttribute('stroke','white');reveal.setAttribute('stroke-width','10');reveal.setAttribute('fill','none');reveal.setAttribute('stroke-dasharray','1');reveal.setAttribute('stroke-dashoffset','1');mask.append(reveal);defs.append(mask);group.append(defs);
    trail.setAttribute('d',d);trail.setAttribute('fill','none');trail.setAttribute('stroke','#86a17a');trail.setAttribute('stroke-width','2');trail.setAttribute('stroke-dasharray','5 9');trail.setAttribute('stroke-linecap','round');trail.setAttribute('mask',`url(#${mask.id})`);group.append(trail);group.setAttribute('opacity','0');layer.prepend(group);
    const length=trail.getTotalLength(),progress={p:0},cursor=document.getElementById('cursor'),orb=document.getElementById('guide-orb');
    tl.set(group,{opacity:.65},m.t);tl.set(cursor,{opacity:1},m.t);tl.set(orb,{opacity:.8},m.t);
    tl.fromTo(progress,{p:0},{p:1,duration:.55,ease:'power2.inOut',immediateRender:false,onUpdate:()=>{
      const point=trail.getPointAtLength(length*progress.p);
      gsap.set(cursor,{x:point.x,y:point.y});
      orb.setAttribute('transform',`translate(${point.x} ${point.y})`);
      reveal.setAttribute('stroke-dashoffset',String(1-progress.p));
    }},m.t);
    tl.to(group,{opacity:0,duration:.45},m.t+.65);
    const next=moves[i+1]?.t??Infinity;
    if(next>m.t+1.1)tl.to(orb,{opacity:0,duration:.3},m.t+.75);
    if(next>m.t+1.35)tl.to(cursor,{opacity:0,duration:.25},m.t+1.05);
  });
}
