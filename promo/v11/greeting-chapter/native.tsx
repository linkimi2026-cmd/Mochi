import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import {ExpressiveOrb} from '../../../client-plugins/jxl-brand/src/ExpressiveOrb';
import {createPainter} from '../../../client-plugins/jxl-brand/src/bloub-motion';
import {sampleMoFrame} from '../motion-pass/sample-mo';
import '../../../client-plugins/jxl-brand/src/ExpressiveOrb.css';
(window as any).initGreeting=()=>{
 const host=document.getElementById('mo-actor')!;
 host.innerHTML=renderToStaticMarkup(<ExpressiveOrb state="idle" size={420} active />);
 const paint=createPainter(host.querySelector<SVGSVGElement>('.expressive-orb__svg')!);
 (window as any).paintGreeting=(t:number)=>paint(sampleMoFrame(t,t<1?-12:0));
 (window as any).paintGreeting(0);
};
