#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  join(workspaceRoot, "00-参赛入口.md"),
  join(workspaceRoot, "README.md"),
  join(workspaceRoot, "Mochi-总体方案.md"),
  join(workspaceRoot, "release", "README.md"),
  join(workspaceRoot, "release", "submission", "README.md"),
];

const skipDirectories = new Set(["history", "reference", "tasks", "node_modules", "evidence", "output"]);

function collect(directory, depth = 0) {
  if (!existsSync(directory) || depth > 3) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirectories.has(entry.name)) collect(path, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
}

collect(join(workspaceRoot, "docs"));
collect(join(workspaceRoot, "参赛材料"));
collect(join(workspaceRoot, "参赛PPT"));
files.push(join(workspaceRoot, "promo", "README.md"));

const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
const failures = [];

for (const file of [...new Set(files)].filter(existsSync)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/u, 1)[0];
    if (!target || /^(?:https?:|mailto:|#)/u.test(target)) continue;
    target = target.split("#", 1)[0];
    try {
      target = decodeURIComponent(target);
    } catch {
      failures.push({ file, target, reason: "invalid URI encoding" });
      continue;
    }
    const absolute = resolve(dirname(file), target);
    if (!existsSync(absolute)) failures.push({ file, target, reason: "missing target" });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`${failure.file.slice(workspaceRoot.length + 1)} -> ${failure.target}: ${failure.reason}`);
  }
  process.exitCode = 1;
} else {
  console.log(`document links OK: ${new Set(files).size} current Markdown files`);
}
