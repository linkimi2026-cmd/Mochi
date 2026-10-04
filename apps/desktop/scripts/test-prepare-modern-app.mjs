import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const {prepareModernApp}=createRequire(import.meta.url)('./prepare-modern-app.cjs');

test('独立App只带桌面壳依赖，旧Host与插件不进入asar；非受管目录拒绝覆盖',t=>{
  const root=mkdtempSync(join(tmpdir(),'mochi-modern-app-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of ['dist-electron','build','node_modules/yaml'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'mochi-desktop',version:'0.1.0',main:'dist-electron/main.js',dependencies:{'old-core':'1.0.0'}}));
  writeFileSync(join(root,'dist-electron/main.js'),'// fixture');writeFileSync(join(root,'node_modules/yaml/package.json'),JSON.stringify({name:'yaml',version:'2.9.0'}));
  const output=prepareModernApp(root);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'package.json'))).dependencies,{yaml:'2.9.0'});
  assert.deepEqual(readdirSync(join(output,'node_modules')),['yaml']);
  assert.equal(prepareModernApp(root),output);
  writeFileSync(join(output,'.mochi-modern-app-marker'),'not-owned');
  assert.throws(()=>prepareModernApp(root),/非受管/);
  assert.equal(readFileSync(join(output,'dist-electron/main.js'),'utf8'),'// fixture');
});
