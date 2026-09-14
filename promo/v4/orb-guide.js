function addOrbGuide(t, path, duration) {
  const geometry = document.createElementNS('http://www.w3.org/2000/svg','path');
  geometry.setAttribute('d',path);
  const length=geometry.getTotalLength(), progress={p:0};
  const orb=document.getElementById('guide-orb');
  tl.set(orb,{opacity:1},t);
  tl.fromTo(progress,{p:0},{p:1,duration,ease:'power2.inOut',immediateRender:false,onUpdate:()=>{
    const point=geometry.getPointAtLength(progress.p*length);
    orb.setAttribute('transform',`translate(${point.x} ${point.y})`);
  }},t);
  tl.to(orb,{opacity:0,duration:.35},t+duration+.1);
}
