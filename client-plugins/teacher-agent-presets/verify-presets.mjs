#!/usr/bin/env node
/**
 * Validate teacher preset resource files through the exact official discovery
 * implementation chosen for Mochi. This never starts a model or reads a live
 * DSH home; it only checks directory metadata and package resolution.
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const presetRoot = scriptDir;
const harnessRoot = process.env.MOCHI_PRESET_HARNESS_ROOT;
assert.ok(harnessRoot, "MOCHI_PRESET_HARNESS_ROOT must name the fixed installed Harness root");
const absoluteHarnessRoot = resolve(harnessRoot);
const shippedPresetRoot = resolve(process.env.MOCHI_SHIPPED_PRESET_ROOT
  ?? join(absoluteHarnessRoot, "node_modules", "@deepseek-ai", "dsh-agent-presets", "presets"));
await access(shippedPresetRoot);

const packagePath = process.env.MOCHI_PRESET_PACKAGE_PATH
  ?? join(absoluteHarnessRoot, "node_modules", "@deepseek-ai", "dsh-agent-presets", "lib", "index.js");
const moduleUrl = pathToFileURL(resolve(packagePath)).href;
const { discoverPresets } = await import(moduleUrl);

const teacherExpected = [
  {
    id: "lesson-planning",
    name: "备课与课件",
    toolNames: ["mochi_ppt_create", "mochi_ppt_revise"],
    skillNames: ["class-meeting-prep", "teaching-material-find"],
  },
  {
    id: "materials-assessment",
    name: "资料与试卷",
    toolNames: ["web_search", "web_fetch"],
    skillNames: ["teaching-material-find"],
  },
  {
    id: "grade-analysis",
    name: "成绩分析",
    toolNames: ["mochi_grade_analyze"],
    skillNames: [],
  },
  {
    id: "classroom-coordination",
    name: "班级与教室",
    toolNames: ["jxl_campus_status", "jxl_relay_list", "mochi_ask", "mochi_request", "mochi_find", "mochi_tasks"],
    skillNames: ["teacher-daily-brief", "student-movement-request"],
  },
];
const legacyExpected = ["standard", "ptc", "minimal", "cordis"];
const expectedIds = [...teacherExpected.map((item) => item.id), ...legacyExpected];

const presets = await discoverPresets(
  [
    { path: presetRoot, trust: "system" },
    { path: shippedPresetRoot, trust: "system" },
  ],
  pathToFileURL(absoluteHarnessRoot + "/").href,
);
assert.deepEqual(presets.map((preset) => preset.id), expectedIds);
for (let index = 0; index < teacherExpected.length; index += 1) {
  const expectedPreset = teacherExpected[index];
  const preset = presets[index];
  assert.equal(preset?.name, expectedPreset.name);
  assert.equal(preset?.trust, "system");
  assert.equal(preset?.broken, undefined, expectedPreset.id + " is broken: " + preset?.broken);

  const directory = join(presetRoot, expectedPreset.id);
  const metadataPath = join(directory, "preset.yml");
  const compositionPath = join(directory, "agent.cordis.yml");
  const files = await Promise.all([readFile(metadataPath, "utf8"), readFile(compositionPath, "utf8")]);
  const metadata = files[0];
  const composition = files[1];
  await access(metadataPath);
  await access(compositionPath);
  assert.match(metadata, new RegExp("^name: " + expectedPreset.name + "$", "m"));
  assert.match(metadata, new RegExp("^order: " + String(index + 1) + "$", "m"));
  for (const toolName of expectedPreset.toolNames) {
    assert.ok(composition.includes(toolName), expectedPreset.id + " omits " + toolName);
  }
  for (const skillName of expectedPreset.skillNames) {
    assert.ok(composition.includes(skillName), expectedPreset.id + " omits " + skillName);
  }
  for (const requiredOfficialRow of [
    "@deepseek-ai/dsh-persona",
    "@deepseek-ai/dsh-agent-instructions",
    "@deepseek-ai/dsh-tool-bash",
    "@deepseek-ai/dsh-tool-pwsh",
    "@deepseek-ai/dsh-tool-fs",
    "@deepseek-ai/dsh-tool-fs-search",
    "@deepseek-ai/dsh-skill-filesystem",
    "@deepseek-ai/dsh-tool-skill",
    "@deepseek-ai/dsh-tool-ask-user",
    "@deepseek-ai/dsh-tool-todo",
  ]) {
    assert.ok(composition.includes(requiredOfficialRow), expectedPreset.id + " omits " + requiredOfficialRow);
  }
}
for (const preset of presets.slice(teacherExpected.length)) {
  assert.equal(preset?.trust, "system");
  assert.equal(preset?.broken, undefined, preset?.id + " is broken: " + preset?.broken);
}

console.log("[teacher-agent-presets] PASS: " + String(teacherExpected.length)
  + " teacher presets precede " + String(legacyExpected.length)
  + " shipped compatibility presets against " + absoluteHarnessRoot);
