import {sampleMoFrame} from './sample-mo';
function finite(value:unknown):boolean{
 if(typeof value==='number')return Number.isFinite(value);
 if(typeof value==='string')return !/NaN|Infinity/.test(value);
 if(value&&typeof value==='object')return Object.values(value).every(finite);
 return true;
}
let count=0;
for(let frame=0;frame<=42*120;frame++){
 const t=frame/120;const sample=sampleMoFrame(t%6,18*Math.sin(t*.7));
 if(!finite(sample))throw Error(`Invalid geometry at frame ${frame}`);count++;
}
const times=[0,1.8,3.4,4.8,5.9,.001,.5,2.7];
for(const t of times){const a=JSON.stringify(sampleMoFrame(t));sampleMoFrame(5.2);if(a!==JSON.stringify(sampleMoFrame(t)))throw Error('Nondeterministic seek '+t)}
console.log(JSON.stringify({finiteFrames:count,randomSeekCases:times.length,ok:true}));
