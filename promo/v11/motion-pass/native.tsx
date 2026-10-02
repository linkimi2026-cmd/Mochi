import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import {OrbCompanion} from '../../../client-plugins/jxl-brand/src/OrbCompanion';
import {createPainter} from '../../../client-plugins/jxl-brand/src/bloub-motion';
import {sampleMoFrame} from './sample-mo';
import '../../../client-plugins/jxl-brand/src/ExpressiveOrb.css';
import '../../../client-plugins/jxl-brand/src/OrbCompanion.css';
(window as any).initMoActor=()=>{
 const host=document.getElementById('mo-actor')!;
 host.innerHTML=renderToStaticMarkup(<OrbCompanion size={420} state="idle" label="Mochi · Mo"/>);
 const paint=createPainter(host.querySelector<SVGSVGElement>('.expressive-orb__svg')!);
 (window as any).paintMo=(t:number,turn=0)=>{
  paint(sampleMoFrame(t,turn));
 };
 (window as any).paintMo(0);
};
