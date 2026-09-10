'use strict';

/**
 * 极简迁移框架。
 *
 * - 每个迁移文件导出 { id, name, up(db), down(db) }
 * - 已执行版本记录在 schema_migrations 表
 * - up / down 各自包在事务里，失败自动回滚
 *
 * 命令行：
 *   node src/db/migrate.js            # 升到最新
 *   node src/db/migrate.js status     # 查看状态
 *   node src/db/migrate.js down [n]   # 回滚 n 个版本（默认 1）
 */

const fs = require('fs');
const path = require('path');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      applied_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

function loadMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort()
    .map((f) => require(path.join(MIGRATIONS_DIR, f)))
    .sort((a, b) => a.id - b.id);
}

function appliedVersions() {
  return new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
}

function up({ silent = false } = {}) {
  ensureMigrationsTable();
  const applied = appliedVersions();
  const pending = loadMigrations().filter((m) => !applied.has(m.id));
  for (const migration of pending) {
    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.id, migration.name);
    });
    tx();
    if (!silent) console.log(`↑ ${migration.id} ${migration.name}`);
  }
  if (!silent && pending.length === 0) console.log('已是最新，无待执行迁移');
  return pending.length;
}

function down(steps = 1) {
  ensureMigrationsTable();
  const all = new Map(loadMigrations().map((m) => [m.id, m]));
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT ?')
    .all(steps);
  for (const row of rows) {
    const migration = all.get(row.version);
    if (!migration) throw new Error(`找不到版本 ${row.version} 的迁移文件，无法回滚`);
    const tx = db.transaction(() => {
      migration.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(row.version);
    });
    tx();
    console.log(`↓ ${migration.id} ${migration.name}`);
  }
  if (rows.length === 0) console.log('没有可回滚的迁移');
  return rows.length;
}

function status() {
  ensureMigrationsTable();
  const applied = appliedVersions();
  const migrations = loadMigrations();
  for (const m of migrations) {
    console.log(`${applied.has(m.id) ? '[已应用]' : '[待执行]'}  ${m.id}  ${m.name}`);
  }
}

if (require.main === module) {
  const [command, arg] = process.argv.slice(2);
  try {
    if (command === 'status') {
      status();
    } else if (command === 'down') {
      down(arg ? parseInt(arg, 10) : 1);
    } else if (command === undefined || command === 'up') {
      up();
    } else {
      console.error(`未知命令：${command}（可用：up / down / status）`);
      process.exit(1);
    }
  } catch (err) {
    console.error('迁移失败：', err.message);
    process.exit(1);
  }
}

module.exports = { up, down, status };
