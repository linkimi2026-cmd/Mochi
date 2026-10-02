// Appended inside the original model module, in the render-only copy.
// The product's exact geometry, controls and derivation code remain in charge.
window.renderMochiModel = function (time) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const smooth = (v) => {const x=clamp(v); return x*x*(3-2*x);};
  const angle = 1.75*smooth((time-.5)/3.5);
  const a = 5+1.5*smooth((time-7)/2);
  const slider = el('sliderA');
  slider.value = String(a);
  slider.dispatchEvent(new Event('input', {bubbles:true}));
  const point = pointOnEllipse(state.a,state.b,angle);
  P.moveTo([point.x,point.y],0);
  setStage(time>=9.8?'derive':time>=4.8?'aux':'observe');
  revealed = Math.min(steps.length,Math.max(0,Math.floor((time-10.25)/.7)+1));
  [...steps].forEach((step,i)=>step.classList.toggle('hidden',i>=revealed));
  updateRevealBtn();updateReadout();board.update();
  window.scrollTo(0,380*smooth((time-10.3)/1.3));
  const rect=el('board').getBoundingClientRect();
  const centre=node=>{const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}};
  const sliderRect=slider.getBoundingClientRect();
  const controls={aux:centre(document.querySelector('[data-stage=aux]')),derive:centre(document.querySelector('[data-stage=derive]')),slider:{x:sliderRect.left+8+(state.a-1)/7*(sliderRect.width-16),y:sliderRect.top+sliderRect.height/2}};
  return {controls,point:{x:rect.left+P.coords.scrCoords[1],y:rect.top+P.coords.scrCoords[2]},a:state.a,b:state.b,stage:time>=9.8?'derive':time>=4.8?'aux':'observe',revealed};
};
window.modelRenderReady=true;
parent.postMessage({type:'mochi-model-render-ready'},location.origin);
