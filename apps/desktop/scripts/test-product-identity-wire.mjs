// Compatibility MiMo bridge only; the active modern route is official llm-pi-ai.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,symlinkSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {productIdentityPrompt,currentProductIdentity} from '../../../plugins/mochi-user-profile/store.mjs';
const repo=resolve(import.meta.dirname,'../../..'),root=mkdtempSync(join(tmpdir(),'mochi-identity-wire-'));
const modules=join(repo,'apps/desktop/runtime-modern/node_modules');let body;
const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;body=JSON.parse(text);res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'fixture only'},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});
try {
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 symlinkSync(modules,join(root,'node_modules'));cpSync(join(repo,'plugins/mochi-llm-mimo/openai-adapter.mjs'),join(root,'adapter.mjs'));
 const {createMimoAdapter,resolveOptions}=await import(pathToFileURL(join(root,'adapter.mjs')));
 const config=resolveOptions({baseURL:`http://127.0.0.1:${server.address().port}/v1`,apiKeyEnv:'FIXTURE_KEY',models:[{id:'mimo-v2.5-pro',inputModalities:['text'],contextWindow:262144,maxTokens:2048}],reasoningEffort:'high'});
 const adapter=createMimoAdapter({options:()=>config,resolveApiKey:async()=> 'local-fixture-only'},error=>error);
 for await(const _ of adapter.stream({provider:'mochi-mimo',model:'mimo-v2.5-pro',reasoningEffort:'high',messages:[
  {role:'system',content:[{type:'text',text:productIdentityPrompt('teacher')}]},
  {role:'user',content:[{type:'text',text:currentProductIdentity()}]},
  {role:'user',content:[{type:'text',text:'你叫什么名字？请只回答名字。'}]},
 ]})){}
 assert.equal(body.model,'mimo-v2.5-pro');assert.equal(body.reasoning_effort,'high');
 assert.ok(body.messages.some(m=>m.role==='system'&&m.content.includes('直接回答“我叫 Mochi”')));
 assert.ok(body.messages.some(m=>m.role==='user'&&m.content.includes('本轮应用助手的产品名字是 Mochi')));
 const evidence={passed:true,adapter:'compatibility mochi-mimo bridge over public PiAiAdapter',actualCurrentRouteVerified:false,remoteRequest:false,model:body.model,reasoningEffort:body.reasoning_effort,systemIdentityPreserved:true,currentContextPreserved:true,credentialsPrinted:false};
 const path=join(repo,'docs/evidence/harness-upgrade-2026-09-30/product-identity-wire.json');writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');console.log(path);
}finally {server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true});}
