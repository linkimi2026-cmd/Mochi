#!/usr/bin/env node
/**
 * 文档一致性扫描（开发期工具，不进包）。
 *
 * 只做「取证」：把各类矛盾线索连同 `文件:行号` 一次性列出来，避免手工翻 100+ 份文档。
 * 判定结论由人给，脚本不自动改任何文件。
 *
 * 用法：node scripts/scan-doc-drift.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".workbuddy",
  "dist",
  "release",
  ".mochi-home.nosync",
  "dsh-src.nosync",
  "mochi-harness-src.nosync",
  "campus.nosync",
  "probe-log.nosync",
  "artifacts",
  "vendor",
  "tools",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/** 每条规则：id = 想查的矛盾类别，pattern = 行内正则，note = 为什么这条要人工看。 */
const RULES = [
  {
    id: "权威声明",
    pattern: /唯一事实源|唯一权威|唯一权威来源|以本文为准|为准$/,
    note: "「唯一事实源」只能有一个。所有命中都要复核是否与其他文档冲突。",
  },
  {
    id: "截止日期",
    pattern: /2026-0?9-?(11|30)|9\s*月\s*(11|30)\s*日|09-11|09-30/,
    note: "09-11 = Mochi 出包/演示截止（已过）；09-30 = 嘉行联参赛材料截止。两条线不要混。",
  },
  {
    id: "内核版本",
    pattern: /0\.1\.[0-9]+-(rc|alpha)\.[0-9]+/,
    note: "运行时实际锁的是 0.1.3-alpha.1；写 0.1.2-rc.1 的都过时。",
  },
  {
    id: "插件计数",
    pattern: /\b(12|16|19|20|21|24|26)\s*(个)?插件|插件\s*(12|16|19|20|21|24|26)\b|EXPECTED_BUNDLED_PLUGIN_COUNT|白名单\s*\d+\s*→\s*\d+/,
    note: "打包白名单当前是 26 个插件（2026-09-12）。历史数字必须标成历史。",
  },
  {
    id: "点号工具名",
    pattern: /`(mochi|jxl|file|doc|pdf|ppt|spreadsheet|image|message|graph)\.[a-z][a-z_]*`/,
    note: "模型可见工具名只能 [a-zA-Z0-9_-]，点号会让网关 400 拒收整轮对话。",
  },
  {
    id: "手工热修",
    pattern: /热修|hotfix|hot-fix|补丁包|一键修复|run-fix\.cmd/,
    note: "手工热修路径已被用户否决（见 docs/build-standard.md）。命中要确认是不是在讲历史。",
  },
  {
    id: "模型与公司名",
    pattern: /\bGLM\b|glm-4|智谱|zhipu|MIMO|mimo-v|DeepSeek|deepseek|Claude|GPT-5|Kimi|Qwen|豆包|文心/,
    note: "面向模型的提示词与 persona 里禁止出现；内部技术文档里出现属正常，但要确认不在 persona/prompt 里。",
  },
  {
    id: "预设口径",
    pattern: /极简模式|TPC\s*模式|PTC\s*模式|标准模式|四个预设|4\s*个预设|教师预设/,
    note: "教师端预设已裁定为「只保留创造模式」（cordis）；标准/PTC/极简已过滤。",
  },
  {
    id: "双界面口径",
    pattern: /conversation\.view|DOM relay|relaySelectView|轨迹界面|ui-trajectory/,
    note: "会话只有一个官方 chat 视图；不得再注册第二个 conversation.view。",
  },
  {
    id: "学生端口径",
    pattern: /学生端/,
    note: "学生端 = 本期不做但保留；「功能受限、知识不受限」。",
  },
  {
    id: "状态字段",
    pattern: /最后更新|更新于|last_verified|last_updated/,
    note: "文档头部应带最后更新/状态字段；命中少说明元数据治理没做。",
  },
];

function collectFiles() {
  return [repoRoot, join(repoRoot, "docs"), join(repoRoot, "skills"), join(repoRoot, "plan"), join(repoRoot, "foundation")]
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((dir) => {
      if (dir === repoRoot) return walk(dir).filter((file) => relative(repoRoot, file).split("/").length === 1);
      if (dir === join(repoRoot, "docs")) {
        return walk(dir).filter((file) => !relative(dir, file).startsWith("reference"));
      }
      return walk(dir);
    });
}

const files = [...new Set(collectFiles())].sort();
const results = new Map(RULES.map((rule) => [rule.id, []]));

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        results.get(rule.id).push({
          file: relative(repoRoot, file),
          line: index + 1,
          text: line.trim().slice(0, 160),
        });
      }
    }
  });
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ files: files.map((f) => relative(repoRoot, f)), results: Object.fromEntries(results) }, null, 2)}\n`);
} else {
  process.stdout.write(`[scan] 扫描 ${files.length} 份 markdown\n`);
  for (const rule of RULES) {
    const hits = results.get(rule.id);
    process.stdout.write(`\n## ${rule.id}（${hits.length} 处）\n> ${rule.note}\n`);
    const grouped = new Map();
    for (const hit of hits) {
      if (!grouped.has(hit.file)) grouped.set(hit.file, []);
      grouped.get(hit.file).push(hit);
    }
    for (const [file, fileHits] of grouped) {
      process.stdout.write(`  ${file}\n`);
      for (const hit of fileHits.slice(0, 4)) process.stdout.write(`    :${hit.line}  ${hit.text}\n`);
      if (fileHits.length > 4) process.stdout.write(`    …另有 ${fileHits.length - 4} 处\n`);
    }
  }
}
