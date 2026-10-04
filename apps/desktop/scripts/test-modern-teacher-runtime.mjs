#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const nodeModules = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass the isolated candidate node_modules directory");
const repo = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const runtime = require(join(repo, "apps/desktop/resources/mochi-web/runtime-profile.cjs"));
const root = mkdtempSync(join(tmpdir(), "mochi-modern-teacher-runtime-"));
const expected = { "lesson-planning": "备课与课件", "materials-assessment": "资料与试卷", "grade-analysis": "成绩分析", "classroom-coordination": "班级与教室", standard: "我是 Mochi", minimal: "", ptc: "", cordis: "" };
function probeSource(role, legacySettings) {
  return `import { assembleContextFor } from '@deepseek-ai/dsh-agent';
export const inject=['agents','sessionController','tools','systemPrompt','pluginManager','settings',${role === "teacher" ? "'agentTeams','commands'," : ""}'agentPresets'];
export function apply(ctx){ const timer=setTimeout(()=>void (async()=>{try{
const rows=await ctx.agentPresets.list();
const bundles=(await ctx.pluginManager.listBundles()).map(({name,enabled,optional,error,rows})=>({name,enabled,optional,error,rows:rows.map(x=>x.rowId)}));
const settings=Object.fromEntries(ctx.settings.describe().filter(x=>['ui-theme','jxl-theme','better-sidebar','agent-preset-registry','agent-default-model','llm-pi-ai'].includes(x.ns)).map(x=>[x.ns,x.value]));
const expected=${JSON.stringify(role === "teacher" ? expected : { classroom: "教室大屏" })}; const result=[];
for(const [id,persona] of Object.entries(expected)){
 const created=await ctx.sessionController.create({cwd:${JSON.stringify(root)},agentPreset:id});
 const agent=ctx.agents.get(created.sessionId); if(!agent)throw Error('agent missing: '+id);
 const names=ctx.tools.schemas(agent).map(x=>x.name);
 const prompt=await ctx.systemPrompt.assemble(assembleContextFor(agent));
 const row={id,selected:created.agentPreset===id,persona:JSON.stringify(prompt).includes(persona),tools:names};
 ${role === "teacher" ? "const task=await ctx.agentTeams.createTask(agent,{subject:'隔离任务板验收',description:'无模型调用'}); row.teamTask=ctx.agentTeams.listTasks(agent).some(x=>x.id===task.id); await ctx.commands.execute(agent,'/mochi-work',[],new AbortController().signal); row.workTools=ctx.tools.schemas(agent).map(x=>x.name);" : "row.noShell=!names.includes('bash')&&!names.includes('pwsh');"}
 result.push(row);
}
console.log('MOCHI_MODERN_RUNTIME='+JSON.stringify({role:${JSON.stringify(role)},rows,bundles,result,settings}));process.exit(0);
}catch(e){console.error('MOCHI_MODERN_RUNTIME_ERROR='+String(e));process.exit(1)}})(),1000);
ctx.effect(()=>()=>clearTimeout(timer));}`;
}
async function run(role, legacySettings = false) {
 const homeDir=join(root,role); mkdirSync(homeDir,{recursive:true});
 if(legacySettings) writeFileSync(join(homeDir,'settings.yaml'),"ui-theme: {preference: dark, fontSize: 16}\njxl-theme: {petPalette: sage, campusBackground: paper, uiSound: false}\ndsh-better-sidebar: {agentOpenTools: false, tasksViewMode: tree}\nagent-presets: {default: grade-analysis}\nagent-default-model: {provider: mochi-mimo, model: mimo-v2.5, reasoningEffort: low}\nmochi-llm-mimo: {apiKeyEnv: FIXTURE_MIMO_REF}\n",{mode:0o600});
 runtime.provisionMochiProfiles({homeDir,resourceRoot:join(repo,"apps/desktop/resources/mochi-web"),skillsDir:join(repo,"skills"),workspaceRoot:repo,runtimeNodeModulesRoot:nodeModules,role});
 const probe=join(homeDir,"probe"); mkdirSync(probe,{recursive:true}); mkdirSync(join(probe,"node_modules"));
 symlinkSync(join(nodeModules,"@deepseek-ai"),join(probe,"node_modules/@deepseek-ai"));
 writeFileSync(join(probe,"package.json"),JSON.stringify({name:"mochi-modern-probe",type:"module",main:"index.mjs"}));
 writeFileSync(join(probe,"index.mjs"),probeSource(role,legacySettings));
 const profile=join(homeDir,"profiles/mochi-web"); symlinkSync(probe,join(profile,"node_modules/mochi-modern-probe"));
 const manifest=JSON.parse(readFileSync(join(profile,"package.json"),"utf8"));manifest.dependencies["mochi-modern-probe"]="link:"+probe;
 writeFileSync(join(profile,"package.json"),JSON.stringify(manifest,null,2));
 writeFileSync(join(profile,"cordis.patch.yml"),readFileSync(join(profile,"cordis.patch.yml"),"utf8")+"\n- insert:\n    - id: mochi-modern-probe\n      name: mochi-modern-probe\n");
 const env={PATH:process.env.PATH, HOME:homeDir,DSH_HOME:homeDir,NODE_PATH:nodeModules,DSH_TELEMETRY_DISABLED:"1",NO_COLOR:"1"};
 const output=await new Promise((resolvePromise,reject)=>{
   const child=spawn(process.execPath,[join(nodeModules,"@deepseek-ai/dsh/lib/bin.js"),"--profile","mochi-web","--port","0","--no-open"],{cwd:repo,env,stdio:["ignore","pipe","pipe"]});
   let text="";const collect=chunk=>{text=(text+chunk).slice(-128000)};child.stdout.on("data",collect);child.stderr.on("data",collect);
   const timer=setTimeout(()=>{child.kill("SIGTERM");reject(Error("Runtime timeout\n"+text.replace(/token=\S+/g,"token=[redacted]")))},45000);
   child.once("error",e=>{clearTimeout(timer);reject(e)});child.once("exit",code=>{clearTimeout(timer);if(code===0)resolvePromise(text);else reject(Error(text.replace(/token=\S+/g,"token=[redacted]")))})
 });
 const marker=output.split("\n").find(x=>x.startsWith("MOCHI_MODERN_RUNTIME="));assert.ok(marker,"probe marker missing");
 const result=JSON.parse(marker.slice("MOCHI_MODERN_RUNTIME=".length));
 console.log(JSON.stringify(result));
 if(legacySettings){
  assert.equal(result.settings['ui-theme'].preference,'dark');assert.equal(result.settings['jxl-theme'].petPalette,'sage');
  assert.equal(result.settings['better-sidebar'].agentOpenTools,false);assert.equal(result.settings['better-sidebar'].tasksViewMode,'tree');
  assert.equal(result.settings['agent-preset-registry'].selectedDefault,'grade-analysis');
  assert.equal(result.settings['llm-pi-ai'].providers['mochi-mimo'].apiKeyEnv,'FIXTURE_MIMO_REF');
 }
 for(const row of result.result){assert.equal(row.selected,true,row.id);assert.equal(row.persona,true,row.id);if(role==="teacher"){assert.equal(row.teamTask,true,row.id);for(const name of ["spawn_teammate","team_task_create","team_task_update","list_agents"])assert.ok(row.tools.includes(name),row.id+": "+name)}else assert.equal(row.noShell,true)}
}
try { await run("teacher",process.env.MOCHI_TEST_LEGACY_SETTINGS==='1'); await run("classroom"); console.log("PASS: real sessions, preserved persona, actual Team tools and task board, classroom shell boundary"); }
finally { rmSync(root,{recursive:true,force:true}); }
