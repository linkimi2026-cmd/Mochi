import '../../client-plugins/jxl-theme/styles/jxl-theme-bridge.css';
import '../../client-plugins/jxl-theme/styles/jxl-paper.css';
import '../../client-plugins/jxl-theme/styles/mochi-controls.css';
import lanSource from './assets/lan-source.txt';
import React from '../../apps/desktop/runtime-modern/node_modules/react';
import {renderToStaticMarkup} from '../../apps/desktop/runtime-modern/node_modules/react-dom/server.browser';
import {OrbCompanion} from '../../client-plugins/jxl-brand/src/OrbCompanion';
import {MochiTeam} from '../../client-plugins/jxl-brand/src/MochiTeam';
import {createPainter} from '../../client-plugins/jxl-brand/src/bloub-motion';
import {BotEngine} from '../../client-plugins/jxl-brand/src/vendor/bloub/engine';
import '../../client-plugins/jxl-brand/src/ExpressiveOrb.css';
import '../../client-plugins/jxl-brand/src/OrbCompanion.css';
import '../../client-plugins/jxl-brand/src/MochiTeam.css';

(window as any).initMochiSources=()=>{
// These are product components, imported directly. Only their film-stage placement is animated.
const team={members:[{id:'lead',name:'主 Mochi',role:'lead',phase:'ready'},{id:'lesson',name:'教案',role:'teammate',phase:'ready'},{id:'slides',name:'课件',role:'teammate',phase:'ready'},{id:'grades',name:'成绩',role:'teammate',phase:'ready'}],tasks:[{ownerName:'教案',subject:'整理教学目标',status:'in_progress'},{ownerName:'课件',subject:'制作课堂演示',status:'in_progress'},{ownerName:'成绩',subject:'分析易错问题',status:'in_progress'}]};
{
 document.getElementById('native-orb')!.innerHTML=renderToStaticMarkup(<OrbCompanion size={270} state="idle" label="Mochi"/>);
 document.getElementById('native-team')!.innerHTML=renderToStaticMarkup(<MochiTeam sessionId="lead" useSession={s=>s({})} useSessions={s=>s({projectionsBySession:{lead:{values:{agentTeam:team}}}})} useSessionStatus={s=>s(new Map(team.members.map(m=>[m.id,{running:true}])))} openMember={()=>{}}/>);
}
const bodies=[...document.querySelectorAll<SVGSVGElement>('.expressive-orb__svg')].map(svg=>({svg,paint:createPainter(svg)}));
// Sample original geometry at an explicit frame time. Independent of machine playback speed.
(window as any).paintMochi=(seconds:number)=>bodies.forEach(({svg,paint})=>paint(new BotEngine(100,svg.closest('#native-orb')?'idle':'thinking').sample(seconds)));

(window as any).paintMochi(0);
let lan:any;
(window as any).__ModuleLoader__={load:({factory}:any)=>{lan=factory((name:string)=>{if(name==='react')return React;throw Error(name);});}};
new Function(lanSource)();
lan.apply({effect:(fn:any)=>fn(),slots:{inject:()=>{}}});
const teacher={endpointId:'teacher-demo',role:'teacher',schoolId:'演示学校',displayName:'林老师',fingerprint:'demo-teacher'};
const classroom={endpointId:'class-demo',role:'classroom',schoolId:'演示学校',classId:'高一（1）班',displayName:'高一（1）班',fingerprint:'demo-class'};
const message={messageId:'request-demo',contentType:'REQUEST',from:classroom,recipient:teacher,receivedAt:'2026-10-02T08:00:00+08:00',body:'老师，我想预约今天的数学答疑。',request:{kind:'appointment',student:'小林（演示）',seat:12,material:'数学随堂练习',position:'第3题',topic:'椭圆切线',slot:'今天16:30'}};
const snapshot={...lan.__test.emptySnapshot(),lockedRole:'teacher',identity:teacher,peers:[{identity:classroom,blocked:false,online:true}],inbox:[message],outbox:[],receipts:[]};
document.getElementById('native-request')!.innerHTML=renderToStaticMarkup(React.createElement(lan.__test.TeacherRequestRow,{message,snapshot,busy:false,onConfirm:()=>{}}));

};
