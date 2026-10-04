import React from 'react';
import { ReplyReader } from './reply-reader.mjs';
import { ReplyAudioControl } from './entry-controls.mjs';

export const inject = ['slots', 'sessions', 'sidebarRight'];
const h = React.createElement;
export function apply(ctx) {
  const desktop = window.mochiVoiceChatDesktop;
  const listeners = new Set();
  let state = {enabled:false,busy:true,error:''}, alive = true;
  const publish = changes => {state={...state,...changes};for(const listener of listeners)listener();};
  const reader = new ReplyReader(desktop, error => publish({error}));
  const subscribe = listener => {listeners.add(listener);return () => listeners.delete(listener);};
  const snapshot = () => state;
  let lock = false;
  async function toggle() {
    if (lock || !desktop?.setEnabled) return;
    lock = true; publish({busy:true,error:''});
    try {
      const result = await desktop.setEnabled(!state.enabled);
      if (!alive) return;
      reader.setEnabled(result.enabled);publish({enabled:result.enabled,error:result.error || ''});
    } catch {if(alive)publish({error:'朗读设置暂时无法保存，请重试。'});}
    finally {lock=false;if(alive)publish({busy:false});}
  }
  function Control({root=false}) {
    const value=React.useSyncExternalStore(subscribe,snapshot);
    return h(ReplyAudioControl,{...value,onClick:toggle,root});
  }
  function RootControl() {
    const mounted = ctx.sidebarRight.mounted;
    const sessionId = React.useSyncExternalStore(listener => mounted.subscribe(listener), () => mounted.getSnapshot());
    React.useLayoutEffect(() => {
      reader.bind(sessionId ? ctx.sessions.binding(sessionId) : null);
      return () => reader.unbind();
    },[sessionId]);
    return h(Control,{root:true});
  }
  // The single corner belongs to the official sidebar opener. Leave its store,
  // shortcuts and collapsed/expanded visibility under the original owner.
  ctx.slots.inject('conversation.header.leading',()=>ctx.slots.register({name:'conversation.header.leading',id:'mochi-reply-audio-root'},RootControl));
  ctx.effect(() => {
    const style=document.createElement('style');
    style.textContent='header:has(>[data-conversation-header-leading] [data-mochi-reply-toggle="root"]){grid-template-columns:minmax(0,1fr) 36px;column-gap:24px;padding-inline-end:12px}[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"]){grid-area:1/2;justify-self:end;margin:0}[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"])+div:not([data-slot]),[data-conversation-header-leading]:has([data-mochi-reply-toggle="root"])+[data-slot="conversation.session.header"]>div:has(>[data-conversation-header-corner]){grid-area:1/1;min-width:0}.mochi-reply-audio{flex-shrink:0;-webkit-app-region:no-drag}';
    document.head.append(style);
    if (desktop?.getState && desktop?.setEnabled) {
      void desktop.getState().then(value => {if(!alive)return;reader.setEnabled(value.enabled);publish({enabled:value.enabled,busy:false});},()=>{if(alive)publish({busy:false,error:'朗读设置暂时不可用。'});});
    } else publish({busy:true,error:'回答朗读需要 Mochi 桌面版。'});
    return () => {alive=false;reader.close();style.remove();listeners.clear();};
  });
}
