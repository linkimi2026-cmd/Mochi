import {BotEngine} from '../../../../client-plugins/jxl-brand/src/vendor/bloub/engine';
import {createPainter} from '../../../../client-plugins/jxl-brand/src/bloub-motion';
import type {StateId} from '../../../../client-plugins/jxl-brand/src/vendor/bloub/states';

type Cue=[number,StateId];
const scripts:Record<string,Cue[]>={
 greeting:[[.45,'wide'],[2.45,'play'],[4.7,'idle']],
 mailbox:[[.05,'comet'],[2.5,'notify']],
 collaboration:[[.1,'thinking'],[4.5,'notify'],[13.1,'thinking'],[16.1,'play'],[21,'comet'],[25,'notify']],
 ending:[[0,'thinking'],[1.65,'idle'],[3.1,'wide'],[5.8,'wink']],
};
(window as any).MochiFilmActor={install(config:any){
 const host=document.getElementById('mo-actor'),svg=host?.querySelector<SVGSVGElement>('.expressive-orb__svg');
 if(!host||!svg)return;
 const tl=Object.values((window as any).__timelines)[0] as any;
 const duration=Number(document.querySelector<HTMLElement>('#film')!.dataset.duration);
 const p=config.id==='ending'?config.palettes.find((p:any)=>p.id==='caramel'):config.next||config.palette;
 host.classList.add('film-brand-actor');host.setAttribute('data-mochi-pet-palette',p.id);
 for(const key of ['body','eyes','case','screen','base','front','glyph'])host.style.setProperty('--mochi-pet-'+key,p[key]);
 // Native fill/face rules are scoped to the editorial character, never recorded UI.
 const css=document.createElement('style');css.textContent=`.film-brand-actor{background:radial-gradient(ellipse at 50% 42%,${p.glyph}cc 0%,${p.glyph}66 27%,transparent 62%)}.film-brand-actor .expressive-orb__body{fill:var(--mochi-pet-body)!important}.film-brand-actor .expressive-orb__face{fill:var(--mochi-pet-eyes)!important}`;
 document.head.append(css);
 let cues=scripts[config.id]||[[.1,'wide']] as Cue[];
 if(config.id.startsWith('bridge-')){
  const n=Number(config.id.split('-')[1]);
  const states:StateId[]=['thinking','burst','orbit','notify','comet','thinking','swirl'];
  cues=[[.04,states[n]]];
  if(n===0||n===5)cues.push([duration*.56,'idle']);
  if(n===6)cues.push([1.45,'wide']);
 }
 const paint=createPainter(svg);
 function render(t:number){
  const engine=new BotEngine(100,'idle');
  for(const [at,state]of cues)if(t>=at)engine.setState(state,at);
  engine.setLook({yaw:12*Math.sin(t*.8),pitch:5,mix:.45,spin:0,wander:.04},0);
  const frame=engine.sample(t);paint(frame);
  svg.dataset.filmMotion=engine.state;svg.dataset.filmDots=String(frame.dots.length);
  (window as any).actorEvidence={id:config.id,palette:p.id,time:t,state:engine.state,dots:frame.dots.length,finite:!svg.innerHTML.includes('NaN')&&!svg.innerHTML.includes('Infinity'),source:'product BotEngine + createPainter'};
 }
 let time=0;const clock={get time(){return time},set time(v:number){time=v;render(v)}};
 tl.to(clock,{time:duration,duration,ease:'none'},0);render(0);
}};
