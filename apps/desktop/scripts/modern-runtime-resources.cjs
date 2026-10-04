"use strict";
const { existsSync, readFileSync, readdirSync, lstatSync, cpSync, mkdirSync } = require("node:fs");
const { resolve, join, relative, isAbsolute } = require("node:path");
const { createHash } = require("node:crypto");
const semver = require("semver");

const CORE_VERSION = "0.2.0-rc.2";
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const within = (path, parent) => { const rel = relative(parent, path); return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\")); };

function inspectModernRuntime(runtimeRoot) {
  const root = resolve(runtimeRoot), modules = join(root, "node_modules");
  const manifest = readJson(join(root, "package.json"));
  const lockPath = join(root, "package-lock.json"), lock = readJson(lockPath);
  if (manifest.dependencies?.["@deepseek-ai/dsh"] !== CORE_VERSION) throw new Error("新版运行目录必须固定已审查的 Harness 版本。");
  const ordered = value => JSON.stringify(Object.entries(value ?? {}).sort(([a],[b])=>a.localeCompare(b)));
  if (ordered(lock.packages?.[""]?.dependencies) !== ordered(manifest.dependencies)) throw new Error("运行清单与锁文件不同，请先更新并审查锁文件。");
  const installed = [];
  function walk(directory, prefix = "node_modules") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".bin" || entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name), key = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`运行依赖不能链接到发布目录外：${key}`);
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@")) { walk(path,key); continue; }
      const metadata = readJson(join(path,"package.json")), expected = lock.packages?.[key];
      if (!expected || expected.version !== metadata.version) throw new Error(`运行包与锁文件不一致：${key}`);
      if (metadata.name?.startsWith("@deepseek-ai/dsh") && metadata.version !== CORE_VERSION) throw new Error(`不能混装旧内核：${metadata.name}`);
      installed.push({name:metadata.name,version:metadata.version,path:key});
      if (existsSync(join(path,"node_modules"))) walk(join(path,"node_modules"),`${key}/node_modules`);
    }
  }
  walk(modules);
  if (!installed.some(row=>row.name==="@deepseek-ai/dsh") || !installed.some(row=>row.name==="dsh-better-sidebar"&&row.version==="0.24.1")) throw new Error("新版核心或 sidebar 未完整安装。");
  return {root,modules,coreVersion:CORE_VERSION,installed,lockSha256:createHash("sha256").update(readFileSync(lockPath)).digest("hex")};
}

function copyModernRuntime(runtimeRoot, targetModules) {
  const inspected = inspectModernRuntime(runtimeRoot), target = resolve(targetModules);
  if (within(target,inspected.root) || within(inspected.root,target)) throw new Error("运行资源目标不能覆盖安装源。");
  if (existsSync(target)) throw new Error("新版运行资源目标必须为空且不存在。");
  mkdirSync(target,{recursive:true});
  cpSync(inspected.modules,target,{recursive:true,filter:source=>{
    const rel=relative(inspected.modules,source);
    if (rel.split(/[\\/]/).includes(".bin")) return false;
    if (lstatSync(source).isSymbolicLink()) throw new Error(`运行包中存在未审查链接：${rel}`);
    return !/(?:\.map|\.d\.ts|\.d\.mts|\.d\.cts)$/i.test(source);
  }});
  return inspected;
}

function assertModernPluginPeers(resourceRoot){
  const modules=join(resourceRoot,"node_modules"),plugins=join(resourceRoot,"plugins");let checked=0;
  for(const entry of readdirSync(plugins,{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const manifest=readJson(join(plugins,entry.name,"package.json"));
    for(const [name,range] of Object.entries(manifest.peerDependencies??{})){
      if(!name.startsWith("@deepseek-ai/"))continue;
      const metadata=join(modules,...name.split("/"),"package.json");
      if(!existsSync(metadata)&&manifest.peerDependenciesMeta?.[name]?.optional)continue;
      if(!existsSync(metadata)||!semver.satisfies(readJson(metadata).version,range,{includePrerelease:true}))throw new Error(`新版插件peer不满足：${entry.name} -> ${name} ${range}`);
      checked++;
    }
  }
  return checked;
}

module.exports = {inspectModernRuntime,copyModernRuntime,assertModernPluginPeers};
