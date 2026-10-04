import React from 'react';
import {Button,Tooltip,IconMicrophoneOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';

const h=React.createElement;
const microphone=()=>h(IconMicrophoneOutlineRegular,{size:16,'aria-hidden':true});
const singleLine={whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};

export function VoiceChatEntryControl({enabled,disabled,onClick}) {
  const description='显式开启后，说话会发送到当前会话，Mochi 的回答会在本机朗读';
  return h(Tooltip,{label:description,side:'top',portal:true},
    h(Button,{type:'button',variant:'ghost',size:'sm',icon:microphone(),disabled,onClick,
      'aria-label':enabled?'结束语音对话':'开启语音对话','aria-pressed':enabled,title:description,
      className:'mochi-voice-chat-entry',style:{flexShrink:0,whiteSpace:'nowrap'}},enabled?'结束对话':'语音对话'));
}

export function ListeningEntryControl({wide=true,state,label,description,onClick}) {
  return h(Tooltip,{label:description,side:'right',portal:true,disabled:wide},
    h(Button,{type:'button',variant:'ghost',size:'md',icon:microphone(),onClick,
      'aria-label':label,title:description,'data-mochi-classroom-status':state,'data-wide':String(wide),
      style:{width:wide?'100%':36,minWidth:wide?0:36,height:36,padding:wide?'0 8px':0,
        justifyContent:wide?'flex-start':'center',flexShrink:0,whiteSpace:'nowrap',borderRadius:wide?12:'50%'},
    },wide?h('span',{style:singleLine},label):null));
}

export function ReplyAudioControl({enabled,busy,error,onClick,root=false}) {
  const label=enabled?'关闭回复朗读':'开启回复朗读';
  const icon=h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},
    h('path',{d:'M11 4 6 8H3v8h3l5 4V4Z'}),
    h('path',{d:enabled?'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14':'m16 9 5 6m0-6-5 6'}));
  return h(Tooltip,{label:error || (busy?'正在更新朗读设置…':label),side:'bottom',portal:true},
    h(Button,{type:'button',variant:'ghost',size:'md',icon,disabled:busy,onClick,
      'aria-label':label,'aria-pressed':enabled,'aria-busy':busy,title:error || label,
      className:'mochi-reply-audio','data-mochi-reply-toggle':root?'root':'session',
      style:{width:36,height:36,padding:0,borderRadius:'50%'},children:null}));
}
