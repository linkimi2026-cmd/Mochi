import React from '../../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import '../../../client-plugins/jxl-theme/styles/jxl-theme-bridge.css';
import '../../../client-plugins/jxl-theme/styles/jxl-paper.css';
import '../../../client-plugins/jxl-theme/styles/mochi-controls.css';
import source from './assets/lan-source.txt';
import records from './assets/lan-records.json';

(window as any).initStudentChapter = () => {
  let lan:any;
  (window as any).__ModuleLoader__ = {load:({factory}:any) => {
    lan = factory((name:string) => {if(name === 'react') return React; throw Error(name);});
  }};
  new Function(source)();
  lan.apply({effect:(fn:any)=>fn(), slots:{inject:()=>{}}});
  const teacher = {...lan.__test.emptySnapshot(), ...records.teacher.snapshot};
  const classroom = {...lan.__test.emptySnapshot(), ...records.classroom.snapshot};
  const noop=()=>{};
  function mount(id:string, Component:any, props:any) {
    document.getElementById(id)!.innerHTML=renderToStaticMarkup(React.createElement(Component,{busy:false,onConfirm:noop,...props}));
  }
  for (const kind of ['appointment','question','makeup']) {
    const message=teacher.inbox.find((row:any)=>row.request?.kind===kind);
    if(!message) throw Error(`Missing real ${kind} request`);
    mount(`native-${kind}`,lan.__test.TeacherRequestRow,{message,snapshot:teacher});
    if(kind==='appointment') {
      const firstReceipt={...message};delete firstReceipt.seenAt;delete firstReceipt.seenReceipt;
      mount('native-appointment-before',lan.__test.TeacherRequestRow,{message:firstReceipt,snapshot:{...teacher,outbox:[],receipts:[]}});
    }
  }
  const appointment=classroom.outbox.find((row:any)=>row.request?.kind==='appointment');
  mount('native-appointment-reply',lan.__test.ClassroomRequestRow,{message:appointment,snapshot:classroom});
  const call=teacher.outbox.find((row:any)=>row.directive?.verdicts?.some((item:any)=>item.action==='call'));
  const received=classroom.inbox.find((row:any)=>row.messageId===call?.messageId);
  if(!received || !received.seenAt || received.seenReceipt!=='ACKNOWLEDGED') throw Error('Missing received/seen call evidence');
  mount('native-call-sent',lan.__test.InboxCard,{snapshot:{...teacher,outbox:[call]},focusedMessageId:call.messageId});
  mount('native-call-received',lan.__test.InboxCard,{snapshot:{...classroom,inbox:[received]},focusedMessageId:call.messageId});
  const beforeSeen={...received};delete beforeSeen.seenAt;delete beforeSeen.seenReceipt;
  mount('native-call-new',lan.__test.IncomingMessageCard,{snapshot:{...classroom,inbox:[beforeSeen]},messageId:call.messageId});
  mount('native-call-confirm',lan.__test.ConfirmationCard,{action:lan.__test.confirmationFor('message-seen',{messageId:received.messageId,from:received.from,body:received.body}),onProceed:noop,onCancel:noop});
  // Open the native details disclosures exactly as a user can; do not rewrite their content.
  for(const id of ['native-call-sent','native-call-received']) {
    document.querySelectorAll(`#${id} details`).forEach((el:any)=>el.open=true);
  }
};
