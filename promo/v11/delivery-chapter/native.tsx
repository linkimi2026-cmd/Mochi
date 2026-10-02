import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import '../../../client-plugins/jxl-theme/styles/jxl-theme-bridge.css';
import '../../../client-plugins/jxl-theme/styles/jxl-paper.css';
import '../../../client-plugins/jxl-theme/styles/mochi-controls.css';
import source from './assets/lan-source.txt';
import records from './assets/records.json';
(window as any).initDelivery=()=>{
 let lan:any;(window as any).__ModuleLoader__={load:({factory}:any)=>{lan=factory((name:string)=>{if(name==='react')return React;throw Error(name)})}};
 new Function(source)();lan.apply({effect:(fn:any)=>fn(),slots:{inject:()=>{}}});
 const mount=(id:string,C:any,snapshot:any)=>{snapshot=lan.__test.normalizeSnapshot(snapshot);const message=snapshot.inbox.find((m:any)=>m.attachment)||snapshot.outbox.find((m:any)=>m.attachment);document.getElementById(id)!.innerHTML=renderToStaticMarkup(React.createElement(C,{snapshot,busy:false,fresh:true,focusedMessageId:message?.messageId,onConfirm:()=>{}}))};
 mount('pair-request',lan.__test.PairingCard,records.request.classroom);
 mount('pair-ready',lan.__test.PairingCard,records.paired.teacher);
 mount('file-sent',lan.__test.InboxCard,records.received.teacher);
 mount('file-received',lan.__test.InboxCard,records.received.classroom);
 mount('file-read',lan.__test.InboxCard,records.receipt.teacher);
 document.querySelectorAll('details').forEach(el=>el.open=true);
};
