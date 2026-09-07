import Database from "better-sqlite3";
import { runMigrations } from "./migrator";

/**
 * 数据库模块公共入口（供主进程 Agent B 集成）。
 *
 * ⚠️ 本模块「不 import electron」：DB 文件路径由主进程计算后传入
 *   （Mochi 标准：`path.join(app.getPath('userData'), 'mochi.db')`）。
 *   这样 db 模块可被独立测试脚本（scripts/test-migrate.mjs）直接复用。
 */

/** 打开一个 better-sqlite3 连接，并开启外键约束（D1 方言差异修复点）。 */
export function openDb(filePath: string): Database.Database {
  const db = new Database(filePath);
  // D1 的 PRAGMA foreign_keys 在 better-sqlite3 下必须每个连接显式开启。
  db.pragma("foreign_keys = ON");
  return db;
}

/** 在已打开的连接上跑完所有迁移（幂等，依赖 _migrations 表）。 */
export function migrate(db: Database.Database): void {
  runMigrations(db);
}

/** 关闭连接。 */
export function closeDb(db: Database.Database): void {
  db.close();
}
