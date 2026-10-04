import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const repo=resolve(import.meta.dirname,'../../..');
const require=createRequire(join(repo,'apps/desktop/package.json'));
const {build}=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const temporary=mkdtempSync(join(repo,'apps/desktop/.sidebar-action-test-'));
const modules=join(repo,'apps/desktop/runtime-modern/node_modules');
const primitive=JSON.parse(readFileSync(join(modules,'@deepseek-ai/dsh-client-ui-primitives/package.json')));
assert.equal(primitive.version,'0.2.0-rc.2');
const filename=join(temporary,'action.cjs');
await build({entryPoints:[join(repo,'client-plugins/mochi-onboarding/sidebar-action.mjs')],outfile:filename,
  bundle:true,platform:'node',format:'cjs',external:['react','@deepseek-ai/dsh-client-ui-primitives']});
// Protocol fixture only; actual upstream CSS and live geometry are checked in the Electron test.
const Button=({icon,children,variant,size,...props})=>React.createElement('button',props,icon,children);
const Icon=({size,...props})=>React.createElement('svg',{width:size,height:size,...props});
const primitives={Button,Tooltip:({children})=>children,IconArchiveOutlineRegular:Icon,IconClockOutlineRegular:Icon,IconQuestionOutlineRegular:Icon};
const module={exports:{}};
vm.runInNewContext(readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>{
  if(id==='react')return React;if(id==='@deepseek-ai/dsh-client-ui-primitives')return primitives;throw Error(id);
}});
const {SidebarAction,sidebarIcons}=module.exports;
test.after(()=>rmSync(temporary,{recursive:true,force:true}));

for(const [kind,label,description] of [['memory','记忆','查看记忆'],['planner','课表','课堂管家'],['guide','指引','新手指引']]){
  test(kind+' forwards the primitive protocol with accessible wide and rail controls',()=>{
    let clicks=0;
    const props={label,description,icon:sidebarIcons[kind],onClick:()=>clicks++};
    const narrow=SidebarAction({...props,wide:false}),wide=SidebarAction({...props,wide:true});
    const railHtml=renderToStaticMarkup(narrow),wideHtml=renderToStaticMarkup(wide);
    assert.match(railHtml,new RegExp('aria-label="'+description+'"'));
    assert.match(railHtml,/<svg[^>]*width="18"/);
    assert.doesNotMatch(railHtml,new RegExp('>'+label+'<'),'rail labels cannot wrap into vertical text');
    assert.match(railHtml,/width:36px;min-width:36px;height:36px/);
    assert.match(wideHtml,new RegExp('>'+label+'<'));
    assert.match(wideHtml,/white-space:nowrap/);
    assert.equal(narrow.props.portal,true,'tooltip escapes the narrow sidebar clipping');
    narrow.props.children.props.onClick();assert.equal(clicks,1);
    assert.equal(wide.props.disabled,true,'wide labels need no redundant tooltip');
    assert.equal(narrow.props.children.props.variant,'ghost','existing theme tokens own colors');
  });
}

test('all three generated clients share the official primitives module and preserve slot owners',()=>{
  for(const folder of ['mochi-memory','mochi-classroom-planner','mochi-onboarding']){
    const directory=join(repo,'client-plugins',folder),client=readFileSync(join(directory,'client.js'),'utf8');
    assert.match(client,/require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
    assert.match(client,/data-mochi-sidebar-action/);
    assert.match(readFileSync(join(directory,'client-entry.mjs'),'utf8'),/function Entry\(\{\s*wide\s*\}\)/);
    assert.equal(JSON.parse(readFileSync(join(directory,'package.json'))).peerDependencies['@deepseek-ai/dsh-client-ui-primitives'],'0.2.0-rc.2');
  }
});
