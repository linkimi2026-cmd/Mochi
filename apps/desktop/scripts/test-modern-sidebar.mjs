#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const nodeModules=resolve(process.argv[2]??"");assert.ok(process.argv[2]);
const repo=resolve(import.meta.dirname,"../../..");const require=createRequire(import.meta.url);
const sidebar=require(join(repo,"apps/desktop/resources/mochi-web/modern-sidebar.cjs"));
const presets=require(join(repo,"apps/desktop/resources/mochi-web/modern-presets.cjs"));
const yaml=createRequire(join(nodeModules,"@deepseek-ai/dsh/package.json"))("yaml");
const root=mkdtempSync(join(tmpdir(),"mochi-sidebar-migration-"));
try {
 assert.equal(sidebar.resolveModernSidebar(nodeModules),join(nodeModules,"dsh-better-sidebar"));
 const fake=join(root,"node_modules");mkdirSync(join(fake,"dsh-better-sidebar"),{recursive:true});symlinkSync(join(nodeModules,"@deepseek-ai"),join(fake,"@deepseek-ai"));symlinkSync(join(nodeModules,"semver"),join(fake,"semver"));
 writeFileSync(join(fake,"dsh-better-sidebar/package.json"),readFileSync(join(repo,"plugins/dsh-better-sidebar/package.json")));
 assert.throws(()=>sidebar.resolveModernSidebar(fake),/不兼容/);
 const empty={before:"",after:""};assert.match(sidebar.renderModernSidebarDefaults(empty,root,nodeModules),/agentOpenTools: true/);
 const original="# user preference\ndsh-better-sidebar:\n  agentOpenTools: false\n  tasksViewMode: tree\n";
 writeFileSync(join(root,"settings.yaml"),original);
 assert.equal(sidebar.renderModernSidebarDefaults(empty,root,nodeModules),"");
 assert.equal(readFileSync(join(root,"settings.yaml"),"utf8"),original);
 assert.throws(()=>sidebar.renderModernSidebarDefaults({before:"- insert:\n    - id: dsh-better-sidebar\n      name: dsh-better-sidebar\n      config: {agentOpenTools: false}\n",after:""},root,nodeModules),/手写/);
 for(const id of ["lesson-planning","materials-assessment","grade-analysis","classroom-coordination"]){
  const source=readFileSync(join(repo,"client-plugins/teacher-agent-presets",id,"agent.cordis.yml"),"utf8");
  const migrated=presets.migratePresetPlugins(source,nodeModules);
  const a=yaml.parseDocument(source),b=yaml.parseDocument(migrated);
  assert.equal(a.contents.items[0].getIn(["config","text"]),b.contents.items[0].getIn(["config","prefix"]));
  assert.match(migrated,/!!js/);assert.doesNotMatch(migrated,/^    text:/m);
 }
 assert.throws(()=>presets.migratePresetPlugins("- name: '@deepseek-ai/dsh-persona'\n  config: {text: a, prefix: b}",nodeModules),/冲突/);
 console.log("PASS: reject incompatible sidebar and duplicate manual mounts; preserve opt-out/source; exact persona text and platform expressions");
}finally{rmSync(root,{recursive:true,force:true});}
