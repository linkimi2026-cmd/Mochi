import {readFileSync,writeFileSync} from 'node:fs';
import {popupPageHtml} from '../../../apps/desktop/electron/dsh/rail-pages';
import {teacherRailSnapshot,newAttentionPayloads} from '../../../apps/desktop/electron/dsh/rail-model';
const dir=new URL('./',import.meta.url);
const records=JSON.parse(readFileSync(new URL('../student-chapter/assets/lan-records.json',dir),'utf8'));
const snapshot={...records.teacher.snapshot,peers:records.teacher.snapshot.peers.map((p:any)=>({...p.identity,blocked:p.blocked}))};
const request=snapshot.inbox.find((m:any)=>m.request?.kind==='question');
if(!request)throw Error('Missing recorded student question');
const previous={...snapshot,inbox:snapshot.inbox.filter((m:any)=>m.messageId!==request.messageId)};
const before=teacherRailSnapshot(previous,request.receivedAt),after=teacherRailSnapshot(snapshot,request.receivedAt);
const payload=newAttentionPayloads('teacher-rail',before,after).find(p=>p.id===request.messageId);
if(!payload)throw Error('Original product mapper did not create question notification');
writeFileSync(new URL('assets/payload.json',dir),JSON.stringify(payload,null,2));
writeFileSync(new URL('assets/records.json',dir),JSON.stringify(snapshot));
// Recorded input through the same IPC entrypoint. No live messages or fabricated success.
const bridge=`<script>window.mochiRail={onPopup:fn=>fn(${JSON.stringify(payload).replaceAll('<','\\u003c')}),act:action=>{window.replayAction=action}};</script>`;
const html=popupPageHtml().replace('<script>',bridge+'<script>').replace('</body>',`<script>pauseHide();popupMotion.dispose();window.renderPopupAt=t=>{document.getAnimations().forEach(a=>{a.pause();a.currentTime=1000});};renderPopupAt(0);</script></body>`);
writeFileSync(new URL('assets/popup.html',dir),html);
writeFileSync(new URL('evidence.json',dir),JSON.stringify({mode:'original-components-recorded-state-replay',messageId:request.messageId,kind:request.request.kind,bodyMatches:payload.detail.includes(request.request.body||request.body),popupTitle:payload.title,liveSend:false},null,2)+'\n');
