import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import {OrbCompanion} from '../../../client-plugins/jxl-brand/src/OrbCompanion';
import {createPainter} from '../../../client-plugins/jxl-brand/src/bloub-motion';
import {BotEngine} from '../../../client-plugins/jxl-brand/src/vendor/bloub/engine';
import palettes from '../../../client-plugins/jxl-theme/assets/mochi-palettes.json';
import '../../../client-plugins/jxl-brand/src/ExpressiveOrb.css';
import '../../../client-plugins/jxl-brand/src/OrbCompanion.css';
(window as any).initTeamPalette=()=>{
 document.getElementById('characters')!.innerHTML=palettes.map(p=>`<section class="character" data-mochi-pet-palette="${p.id}">${renderToStaticMarkup(<OrbCompanion size={300} state="idle" label={p.label}/>)}<p>${p.label}</p></section>`).join('');
 const painters=[...document.querySelectorAll<SVGSVGElement>('.expressive-orb__svg')].map(svg=>createPainter(svg));
 (window as any).paintCharacters=(t:number)=>painters.forEach((paint,i)=>paint(new BotEngine(100,'idle').sample(t+i*.38)));
 (window as any).paintCharacters(0);
};
