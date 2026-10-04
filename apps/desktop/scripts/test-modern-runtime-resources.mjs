import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const {inspectModernRuntime,copyModernRuntime,assertModernPluginPeers}=createRequire(import.meta.url)('./modern-runtime-resources.cjs');

function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'mochi-modern-resources-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=join(root,'source'),dependencies={'@deepseek-ai/dsh':'0.2.0-rc.2','dsh-better-sidebar':'0.24.1'};
  mkdirSync(source);const packages={'':{dependencies}};
  for(const [name,version] of Object.entries(dependencies)){
    const path=join(source,'node_modules',name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'package.json'),JSON.stringify({name,version}));writeFileSync(join(path,'index.js'),'export const ready = true;');writeFileSync(join(path,'index.d.ts'),'declare const ready: boolean;');writeFileSync(join(path,'LICENSE'),'fixture license');packages['node_modules/'+name]={version};
  }
  writeFileSync(join(source,'package.json'),JSON.stringify({dependencies}));writeFileSync(join(source,'package-lock.json'),JSON.stringify({packages}));
  return {source,target:join(root,'target')};
}
test('新版资源从锁文件核对后复制，保留运行源码和许可，排除types',t=>{
  const {source,target}=fixture(t);assert.equal(inspectModernRuntime(source).installed.length,2);
  copyModernRuntime(source,target);assert.ok(existsSync(join(target,'@deepseek-ai/dsh/index.js')));assert.ok(existsSync(join(target,'@deepseek-ai/dsh/LICENSE')));assert.ok(!existsSync(join(target,'@deepseek-ai/dsh/index.d.ts')));
  assert.throws(()=>copyModernRuntime(source,target),/不存在/);assert.throws(()=>copyModernRuntime(source,join(source,'output')),/覆盖/);
});
test('版本漂移和越出目录的依赖链接拒绝复制',t=>{
  const {source,target}=fixture(t),path=join(source,'node_modules/dsh-better-sidebar/package.json');
  const original=readFileSync(path);writeFileSync(path,JSON.stringify({name:'dsh-better-sidebar',version:'0.18.0'}));assert.throws(()=>copyModernRuntime(source,target),/锁文件不一致/);assert.ok(!existsSync(target));
  writeFileSync(path,original);symlinkSync(source,join(source,'node_modules/escape'));assert.throws(()=>inspectModernRuntime(source),/发布目录外/);
});
test('插件声明不能把不兼容旧内核带入新版资源',t=>{
  const {source}=fixture(t),plugin=join(source,'plugins','fixture');mkdirSync(plugin,{recursive:true});
  const path=join(plugin,'package.json');
  writeFileSync(path,JSON.stringify({peerDependencies:{'@deepseek-ai/dsh':'0.1.3-alpha.1 || 0.2.0-rc.2'}}));
  assert.equal(assertModernPluginPeers(source),1);
  writeFileSync(path,JSON.stringify({peerDependencies:{'@deepseek-ai/dsh':'0.1.3-alpha.1'}}));
  assert.throws(()=>assertModernPluginPeers(source),/peer不满足/);
  writeFileSync(path,JSON.stringify({peerDependencies:{'@deepseek-ai/absent':'0.2.0-rc.2'},peerDependenciesMeta:{'@deepseek-ai/absent':{optional:true}}}));
  assert.equal(assertModernPluginPeers(source),0);
  writeFileSync(path,JSON.stringify({peerDependencies:{'@deepseek-ai/absent':'0.2.0-rc.2'}}));
  assert.throws(()=>assertModernPluginPeers(source),/peer不满足/);
});
