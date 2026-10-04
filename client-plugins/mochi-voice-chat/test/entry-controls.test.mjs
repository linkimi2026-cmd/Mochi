import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import vm from 'node:vm';

const repo=resolve(import.meta.dirname,'../../..');
const require=createRequire(join(repo,'apps/desktop/package.json'));
const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const temporary=mkdtempSync(join(repo,'apps/desktop/.voice-entry-test-'));
const filename=join(temporary,'entries.cjs');
await build({entryPoints:[join(repo,'client-plugins/mochi-voice-chat/entry-controls.mjs')],outfile:filename,
  bundle:true,platform:'node',format:'cjs',external:['react','@deepseek-ai/dsh-client-ui-primitives']});
// This fixture checks forwarded public props, not upstream CSS or live geometry.
const Button=({icon,children,variant,size,...props})=>React.createElement('button',props,icon,children);
const primitives={Button,Tooltip:({children})=>children,
  IconMicrophoneOutlineRegular:props=>React.createElement('svg',props)};
const module={exports:{}};
vm.runInNewContext(readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>{
  if(id==='react')return React;if(id==='@deepseek-ai/dsh-client-ui-primitives')return primitives;throw Error(id);
}});
const {VoiceChatEntryControl,ListeningEntryControl,ReplyAudioControl}=module.exports;
test.after(()=>rmSync(temporary,{recursive:true,force:true}));

test('voice entry keeps explicit start/stop labels and disabled state on the official control',()=>{
  let clicks=0;
  for(const enabled of [false,true]) {
    const tip=VoiceChatEntryControl({enabled,disabled:true,onClick:()=>clicks++}),button=tip.props.children;
    assert.equal(button.props.variant,'ghost');assert.equal(button.props.size,'sm');
    assert.equal(button.props['aria-pressed'],enabled);assert.equal(button.props.disabled,true);
    assert.equal(button.props['aria-label'],enabled?'结束语音对话':'开启语音对话');
    assert.equal(tip.props.portal,true);assert.ok(button.props.icon);button.props.onClick();
  }
  assert.equal(clicks,2);
});

test('listening rail preserves status access without vertical text; wide labels remain one line',()=>{
  const props={state:'error',label:'监听需要处理',description:'请准备本地识别模型',onClick:()=>{}};
  const rail=ListeningEntryControl({...props,wide:false}),wide=ListeningEntryControl({...props,wide:true});
  assert.equal(rail.props.children.props['data-wide'],'false');
  assert.equal(rail.props.children.props['data-mochi-classroom-status'],'error');
  assert.equal(rail.props.children.props['aria-label'],props.label);
  assert.equal(rail.props.children.props.style.width,36);assert.equal(rail.props.children.props.children,null);
  assert.match(renderToStaticMarkup(wide),/white-space:nowrap/);
  assert.match(renderToStaticMarkup(wide),/text-overflow:ellipsis/);
  assert.match(renderToStaticMarkup(wide),/>监听需要处理</);
  assert.equal(wide.props.disabled,true);assert.equal(rail.props.portal,true);
});

test('both generated clients share the official ModuleLoader primitive and pinned peer contract',()=>{
  for(const name of ['mochi-voice-chat','mochi-classroom-assistant']) {
    const path=join(repo,'client-plugins',name);
    assert.match(readFileSync(join(path,'client.js'),'utf8'),/require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
    assert.equal(JSON.parse(readFileSync(join(path,'package.json'))).peerDependencies['@deepseek-ai/dsh-client-ui-primitives'],'0.2.0-rc.2');
  }
  assert.match(readFileSync(join(repo,'client-plugins/mochi-classroom-assistant/client-entry.mjs'),'utf8'),/function Entry\(\{wide\}\)/);
});


test('reply speaker is one icon-only output toggle with visible busy and pressed semantics',()=>{
  for(const enabled of [false,true]) {
    let calls=0;
    const tip=ReplyAudioControl({enabled,busy:false,error:'',root:true,onClick:()=>calls++});
    const button=tip.props.children;
    assert.equal(button.props['aria-label'],enabled?'关闭回复朗读':'开启回复朗读');
    assert.equal(button.props['aria-pressed'],enabled);assert.equal(button.props.children,null);
    assert.equal(button.props['data-mochi-reply-toggle'],'root');assert.equal(button.props.variant,'ghost');
    assert.equal(button.props.style.width,36);assert.ok(button.props.icon);button.props.onClick();assert.equal(calls,1);
  }
  const busy=ReplyAudioControl({enabled:false,busy:true});
  assert.equal(busy.props.children.props.disabled,true);assert.equal(busy.props.children.props['aria-busy'],true);
  const entry=readFileSync(join(repo,'client-plugins/mochi-voice-chat/client-entry.mjs'),'utf8');
  assert.doesNotMatch(entry,/ctx.slots.(?:inject|register)\([^\n]*conversation.session.header.corner/);
  assert.match(entry,/conversation.header.leading/);assert.match(entry,/ctx.sidebarRight.mounted/);
  assert.doesNotMatch(entry,/conversation.input|Recorder|VoiceChatController|remote\.speech|submitSpeech/);
});
