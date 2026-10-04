// Import the actual production whitelist, rather than the source directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const repo=resolve(import.meta.dirname,'../../..'),require=createRequire(import.meta.url);
const {PLUGINS}=require('./prepare-mochi-resources.cjs'),{smokeResultAccepted}=require('./smoke-packaged.cjs');
const packaged=join(repo,'apps/desktop/release/mac-arm64/Mochi.app/Contents/MacOS/Mochi');
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'mochi-profile-closure-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const id of ['mochi-user-profile','mochi-memory']){const row=PLUGINS.find(p=>p.id===id);assert.ok(row);for(const file of row.files){const target=join(root,'plugins',id,file);mkdirSync(dirname(target),{recursive:true});cpSync(join(repo,row.source,file),target);}}
 const entry=pathToFileURL(join(root,'plugins/mochi-user-profile/index.mjs')).href;
 const run=()=>spawnSync(process.env.MOCHI_IMPORT_RUNTIME??(existsSync(packaged)?packaged:process.execPath),['--input-type=module','-e','const m=await import(process.argv[1]);if(typeof m.apply!=="function")throw Error("missing apply");console.log(JSON.stringify({electron:process.versions.electron??null,node:process.versions.node,imported:true}));',entry],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:root,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:root,MOCHI_RUNTIME_HOME:root}});
 return {root,run};
}
test('production profile whitelist imports including shared greeting and memory dependencies',t=>{
 const {run}=fixture(t),result=run();assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.imported,true);if(existsSync(packaged)&&!process.env.MOCHI_IMPORT_RUNTIME)assert.equal(actual.electron,'44.0.0');
});
test('missing policy reproduces the actual release error; restoring it repairs the same physical stage',t=>{
 const {root,run}=fixture(t),file=join(root,'plugins/mochi-user-profile/greeting-policy.mjs');rmSync(file);const broken=run();assert.notEqual(broken.status,0);assert.match(broken.stderr,/ERR_MODULE_NOT_FOUND/);assert.match(broken.stderr,/greeting-policy\.mjs/);cpSync(join(repo,'plugins/mochi-user-profile/greeting-policy.mjs'),file);const repaired=run();assert.equal(repaired.status,0,repaired.stderr);
});
test('desktop smoke cannot accept an import failure even when the shell prints its OK marker',()=>{
 assert.equal(smokeResultAccepted(0,'MOCHI_DESKTOP_SMOKE_OK http://127.0.0.1'),true);
 assert.equal(smokeResultAccepted(0,'mochi-user-profile (mochi-user-profile): failed to import\nMOCHI_DESKTOP_SMOKE_OK'),false);
 assert.equal(smokeResultAccepted(0,'other-plugin: FAILED TO IMPORT\nMOCHI_DESKTOP_SMOKE_OK'),false);
 assert.equal(smokeResultAccepted(1,'MOCHI_DESKTOP_SMOKE_OK'),false);
 assert.equal(smokeResultAccepted(0,'MOCHI_DESKTOP_SMOKE_FAILED\nMOCHI_DESKTOP_SMOKE_OK'),false);
});
