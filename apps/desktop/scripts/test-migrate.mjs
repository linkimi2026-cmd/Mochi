#!/usr/bin/env node
/**
 * 独立迁移验证脚本（Batch 1 / Agent A）。
 *
 * 用 better-sqlite3 跑完所有迁移，并校验：
 *   - sqlite_master 中表数量 >= 30（嘉行联 34 张表，部分以视图/索引形式存在）
 *   - 关键资产表 mochi_relay_messages、mochi_resources 存在
 *
 * 用 .mjs 是因为 vite/electron 还没集成这条链路；这里直接复用编译后的 migrator，
 * 并把迁移目录显式指向源码（electron/db/migrations），不依赖 dist-electron 是否已拷贝。
 */

import Database from "better-sqlite3";
import { unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // apps/desktop
const MIGRATOR = join(ROOT, "dist-electron", "db", "migrator.js");
const MIGRATIONS_DIR = join(ROOT, "electron", "db", "migrations");
const TEST_DB = "/tmp/mochi-test.db";

// 复用编译后的真实 migrator，保证验证的是生产代码路径。
const { runMigrations } = await import(MIGRATOR);

function fail(msg) {
  console.error(`[test-migrate] FAIL: ${msg}`);
  process.exit(1);
}

console.log(`[test-migrate] migrations dir: ${MIGRATIONS_DIR}`);
if (!existsSync(MIGRATIONS_DIR)) fail(`迁移目录不存在：${MIGRATIONS_DIR}`);

// 每次从干净库开始
if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

const db = new Database(TEST_DB);
try {
  const applied = runMigrations(db, MIGRATIONS_DIR);
  console.log(`[test-migrate] runMigrations returned applied = ${applied}`);

  const totalTables = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
    .get().n;
  const userTables = db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name <> '_migrations'",
    )
    .get().n;

  console.log(`[test-migrate] total tables (incl. _migrations) = ${totalTables}`);
  console.log(`[test-migrate] user tables (excl. _migrations)   = ${userTables}`);

  if (userTables < 30) {
    fail(`用户表数 ${userTables} < 30（嘉行联基线应约 34 张）`);
  }

  const mustHave = ["mochi_relay_messages", "mochi_resources"];
  for (const t of mustHave) {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(t);
    if (!row) fail(`关键资产表缺失：${t}`);
    console.log(`[test-migrate] OK 关键表存在: ${t}`);
  }

  // 额外抽查：mochi_relay_messages 是否带 0025 扩展列
  const cols = db
    .prepare("PRAGMA table_info(mochi_relay_messages)")
    .all()
    .map((c) => c.name);
  console.log(`[test-migrate] mochi_relay_messages columns: ${cols.join(", ")}`);
  if (!cols.includes("kind") || !cols.includes("item")) {
    fail("mochi_relay_messages 缺少 0025 扩展列 (kind/item)");
  }

  console.log(
    `[test-migrate] PASS: ${userTables} user tables, key assets present.`,
  );
  process.exit(0);
} catch (err) {
  console.error("[test-migrate] ERROR during migration:");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
} finally {
  db.close();
}
