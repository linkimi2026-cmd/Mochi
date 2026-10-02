import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {createRoot} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/client';
import '../../../client-plugins/jxl-theme/styles/jxl-theme-bridge.css';
import '../../../client-plugins/jxl-theme/styles/jxl-paper.css';
import '../../../client-plugins/jxl-theme/styles/mochi-controls.css';
import source from './assets/lan-source.txt';
import recorded from './assets/records.json';
import payload from './assets/payload.json';
let lan:any;
(window as any).__ModuleLoader__={load:({factory}:any)=>{lan=factory((name:string)=>{if(name==='react')return React;throw Error(name)})}};
new Function(source)();
lan.apply({effect:(fn:any)=>fn(),slots:{inject:()=>{}}});
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input:any,options:any)=>{
 const url=String(input);
 if(url==='/api/mochi-profile')return new Response(JSON.stringify({profile:null}),{headers:{'content-type':'application/json'}});
 if(!url.startsWith('/api/mochi-lan/'))return nativeFetch(input,options);
 if(options?.method&&options.method!=='GET')throw Error('Recorded presentation is read-only');
 const data=url.endsWith('/state')?recorded:url.endsWith('/discovery')?{candidates:[]}:{events:[],cursor:0};
 return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
};
(window as any).mochiRailDesktop={pushLanState:()=>{},reportSyncHealth:()=>{}};
function mount(){const target=document.getElementById('native-mailbox');if(!target)return;createRoot(target).render(React.createElement(lan.__test.LanPanel,{focusedMessageId:payload.id,onClose:()=>{}}));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
(window as any).mailboxEvidence={messageId:payload.id,mode:'recorded-state',productComponent:'LanPanel'};
