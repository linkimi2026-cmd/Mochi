import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D1 → better-sqlite3 迁移执行器。
 *
 * 设计要点（对照 11_MIGRATION_MAP.md §3 / 06 §1.4）：
 *  - D1 迁移文件是标准 SQLite，文本 95% 可直接跑；唯一真正的方言差异是
 *    `PRAGMA foreign_keys = ON`（见 0001_schema.sql 顶部 `-- TODO_D1_DELTA` 注释）。
 *    better-sqlite3 中 foreign_keys 不能靠 db.exec() 跨语句持久，必须在「每个连接建立时」
 *    用 db.pragma('foreign_keys = ON') 设置——openDb() 与 runMigrations() 都已处理。
 *  - 其余 D1 特性（AUTOINCREMENT / datetime('now') / CURRENT_TIMESTAMP /
 *    ON CONFLICT / RETURNING / 部分索引 / CHECK / REFERENCES ... ON DELETE CASCADE）均为
 *    标准 SQLite，better-sqlite3 原生支持，无需改写。
 *  - 多语句：D1 逐文件跑；这里读 migrations/*.sql 按文件名排序逐文件 db.exec()，
 *    并把已应用文件记进 _migrations 表，保证幂等（可重复跑）。
 */

const DEFAULT_MIGRATIONS_DIR = join(__dirname, "migrations");

/** 维护 _migrations 表（filename 主键），保证每个迁移只执行一次。 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function isApplied(db: Database.Database, filename: string): boolean {
  const row = db
    .prepare("SELECT filename FROM _migrations WHERE filename = ?")
    .get(filename);
  return row !== undefined;
}

/**
 * 顺序执行 migrations 目录下所有 *.sql（按文件名排序），幂等。
 *
 * @param db            已打开（且已开启 foreign_keys）的 better-sqlite3 连接
 * @param migrationsDir 迁移文件目录，默认取 __dirname/migrations（编译后即
 *                      dist-electron/electron/db/migrations）。测试脚本可显式传入源码目录。
 * @returns 本次新应用的迁移数量
 */
export function runMigrations(
  db: Database.Database,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): number {
  // D1 方言差异点：foreign_keys 必须在每个连接上显式开启（不能依赖迁移里的 PRAGMA）。
  db.pragma("foreign_keys = ON");

  if (!existsSync(migrationsDir)) {
    throw new Error(
      `[mochi.db] 迁移目录不存在：${migrationsDir}（请确认 electron/db/migrations 已复制到运行目录）`,
    );
  }

  ensureMigrationsTable(db);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();

  let applied = 0;
  for (const file of files) {
    if (isApplied(db, file)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");

    // 每个迁移文件作为一个事务：失败整体回滚，且 _migrations 记录也在同一事务内，
    // 不会出现「表建了但记录没写」的中间态。
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
    });
    tx();

    applied += 1;
    console.log(`[mochi.db] applied migration: ${file}`);
  }

  console.log(`[mochi.db] applied ${applied} migrations`);
  return applied;
}
