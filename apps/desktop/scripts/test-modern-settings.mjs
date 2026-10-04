#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const nodeModules=resolve(process.argv[2]??"");assert.ok(process.argv[2]);
const repo=resolve(import.meta.dirname,"../../..");const require=createRequire(import.meta.url);
const runtime=require(join(repo,"apps/desktop/resources/mochi-web/runtime-profile.cjs"));
const yaml=createRequire(join(nodeModules,"@deepseek-ai/dsh/package.json"))("yaml");
const root=mkdtempSync(join(tmpdir(),"mochi-modern-settings-"));
const resources=join(repo,"apps/desktop/resources/mochi-web");
const options=homeDir=>({homeDir,resourceRoot:resources,skillsDir:join(repo,"skills"),workspaceRoot:repo,runtimeNodeModulesRoot:nodeModules,role:"teacher"});
try {
 const home=join(root,"teacher");mkdirSync(home);
 const source=yaml.stringify({"ui-theme":{preference:"dark",fontSize:16},"jxl-theme":{petPalette:"sage",uiSound:false,campusBackground:"paper"},
  "agent-default-model":{provider:"mochi-mimo",model:"mimo-v2.5",reasoningEffort:"low"},"agent-presets":{default:"grade-analysis"},
  "mochi-llm-mimo":{apiKeyEnv:"FIXTURE_MIMO_REF",baseURL:"http://127.0.0.1:19899/v1"},
  "dsh-better-sidebar":{agentOpenTools:false,tasksViewMode:"tree",editorExplorer:true,workspaceFence:false}});
 writeFileSync(join(home,"settings.yaml"),source,{mode:0o600});
 const credentialSource="FIXTURE_MIMO_REF: fixture-not-a-real-credential\n";
 writeFileSync(join(home,".credentials.yaml"),credentialSource,{mode:0o600});
 runtime.provisionMochiProfiles(options(home));
 const result=yaml.parse(readFileSync(join(home,"settings.yaml"),"utf8"));
 assert.equal(result["agent-preset-registry"].selectedDefault,"grade-analysis");
 assert.equal(result["llm-pi-ai"].providers["mochi-mimo"].apiKeyEnv,"FIXTURE_MIMO_REF");
 for(const section of ["ui-theme","jxl-theme","agent-default-model"])assert.deepEqual(result[section],yaml.parse(source)[section]);
 const sidebarExpected=yaml.parse(source)["dsh-better-sidebar"];delete sidebarExpected.workspaceFence;
 assert.deepEqual(result["dsh-better-sidebar"],sidebarExpected);
 assert.equal(readFileSync(join(home,".mochi-settings-legacy.yaml"),"utf8"),source);
 assert.equal(readFileSync(join(home,".credentials.yaml"),"utf8"),credentialSource);
 assert.equal(statSync(join(home,".mochi-settings-legacy.yaml")).mode&0o077,0);
 assert.deepEqual(runtime.provisionMochiProfiles(options(home)).updated,[]);
 const gatewayHome=join(root,"gateway-valid");mkdirSync(gatewayHome);
 const legacyGateway={apiKeyEnv:"FIXTURE_GATEWAY_REF",baseURL:"http://127.0.0.1:19899/v1",thinking:"enabled",reasoningEffort:"medium",
  models:[{id:"custom-fast",name:"My fast model",description:"Original description",contextWindow:1000000,maxTokens:12345},{id:"custom-pro",name:"My pro model",contextWindow:1000000,maxTokens:54321}]};
 const oldGateway=yaml.stringify({"llm-deepseek":legacyGateway,"agent-default-model":{provider:"deepseek-official",model:"custom-pro",reasoningEffort:"medium"},
  "llm-pi-ai":{providers:{untouched:{api:"openai-completions",apiKeyEnv:"FIXTURE_OTHER_REF",baseURL:"http://127.0.0.1:19898/v1",models:[{id:"other"}]}}}});
 writeFileSync(join(gatewayHome,"settings.yaml"),oldGateway,{mode:0o600});
 writeFileSync(join(gatewayHome,".credentials.yaml"),credentialSource,{mode:0o600});
 runtime.provisionMochiProfiles(options(gatewayHome));
 const migrated=yaml.parse(readFileSync(join(gatewayHome,"settings.yaml"),"utf8"));const route=migrated["llm-pi-ai"].providers["deepseek-official"];
 assert.equal(migrated["llm-deepseek"],undefined);assert.equal(route.baseURL,legacyGateway.baseURL);assert.equal(route.apiKeyEnv,legacyGateway.apiKeyEnv);
 assert.equal(route.api,"openai-completions");assert.equal(route.reasoning,"medium");assert.equal(route.compat.supportsDeveloperRole,false);assert.equal(route.compat.maxTokensField,"max_tokens");
 assert.equal(route.models[0].description,"Original description");assert.equal(route.models[1].maxTokens,54321);assert.equal(route.models[0].reasoningEfforts.max,"max");
 assert.deepEqual(migrated["agent-default-model"],yaml.parse(oldGateway)["agent-default-model"]);assert.deepEqual(migrated["llm-pi-ai"].providers.untouched,yaml.parse(oldGateway)["llm-pi-ai"].providers.untouched);
 assert.equal(readFileSync(join(gatewayHome,".mochi-settings-legacy.yaml"),"utf8"),oldGateway);assert.equal(readFileSync(join(gatewayHome,".credentials.yaml"),"utf8"),credentialSource);
 const patch=join(gatewayHome,"profiles/mochi-web/cordis.patch.yml");const firstPatch=readFileSync(patch,"utf8");assert.ok(yaml.parse(firstPatch,{logLevel:"silent"}).some(row=>row.id==="llm-deepseek"&&row.disabled===true));
 assert.deepEqual(runtime.provisionMochiProfiles(options(gatewayHome)).updated,[]);assert.equal(readFileSync(patch,"utf8"),firstPatch);
 // Upstream retires settings.yaml after import. The durable disable belongs to the profile, not a startup flag.
 const {renameSync}=require("node:fs");renameSync(join(gatewayHome,"settings.yaml"),join(gatewayHome,"settings.yaml.imported"));
 assert.deepEqual(runtime.provisionMochiProfiles(options(gatewayHome)).updated,[]);assert.equal(readFileSync(patch,"utf8"),firstPatch);
 for(const [name,delta]of Object.entries({conflict:{"llm-pi-ai":{providers:{"deepseek-official":{api:"anthropic-messages",models:[{id:"different"}]}}}},
  unknownGateway:{"llm-deepseek":{...legacyGateway,surprise:true}},unknownModel:{"llm-deepseek":{...legacyGateway,models:[{id:"custom",imageDetail:"high"}]}},
  duplicate:{"llm-deepseek":{...legacyGateway,models:[{id:"duplicate"},{id:"duplicate"}]}},thinking:{"llm-deepseek":{...legacyGateway,thinking:"disabled"}},
  invalidProtocol:{"llm-deepseek":{...legacyGateway,baseURL:"file:///tmp/not-a-provider"}},
  fencedSidebar:{"dsh-better-sidebar":{workspaceFence:true,agentOpenTools:true}}})){
  const dir=join(root,name);mkdirSync(dir);const text=yaml.stringify({"llm-deepseek":legacyGateway,...delta});writeFileSync(join(dir,"settings.yaml"),text);
  assert.throws(()=>runtime.provisionMochiProfiles(options(dir)),/原文件未修改/);assert.equal(readFileSync(join(dir,"settings.yaml"),"utf8"),text);assert.equal(existsSync(join(dir,"profiles")),false);assert.equal(existsSync(join(dir,".mochi-settings-legacy.yaml")),false);
 }
 for(const [name,settings] of Object.entries({unknown:{"private-plugin":{x:1}},field:{"ui-theme":{surprise:true}},gateway:{"llm-deepseek":{baseURL:"https://gateway.example.invalid/v1"}}})){
  const dir=join(root,name);mkdirSync(dir);const text=yaml.stringify(settings);writeFileSync(join(dir,"settings.yaml"),text);
  assert.throws(()=>runtime.provisionMochiProfiles(options(dir)),/尚未|未通过|需确认/);
  assert.equal(readFileSync(join(dir,"settings.yaml"),"utf8"),text);assert.equal(existsSync(join(dir,"profiles")),false);
 }
 console.log("PASS: preferences/aliases; custom Chat Completions gateway, catalog/default/credential references retained; durable official-route disable after imported cold start; conflicts/unknown fields rejected before writes; backup 0600; credentials untouched; idempotence");
}finally{rmSync(root,{recursive:true,force:true});}
