'use strict';

/**
 * 借阅管理模块。
 *
 * - loans：借阅记录，一条记录对应一次「借出 → 归还」
 *   return_date 为 NULL 表示书仍在读者手上
 *   状态（在借 / 即将到期 / 逾期 / 已归还）不在表里冗余存储，
 *   由 services/loan-service.js 按本地日期实时计算，天然“自动标记”。
 * - books.total_loan_count：累计借出次数，每成功借出一本 +1（续借不累加）。
 * - 两个部分唯一索引（SQLite partial index）在数据库层兜底业务规则：
 *   1) 同一本书同时只能有一笔未归还记录（单馆藏）
 *   2) 同一读者对同一本书，未归还前不能重复借阅
 */
module.exports = {
  id: 2,
  name: 'loans',

  up(db) {
    db.exec(`
      ALTER TABLE books ADD COLUMN total_loan_count INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE loans (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id       INTEGER NOT NULL,
        reader_id     INTEGER NOT NULL,
        loan_date     TEXT NOT NULL,                  -- 借出日期 YYYY-MM-DD（本地日期）
        due_date      TEXT NOT NULL,                  -- 应还日期 YYYY-MM-DD（本地日期）
        return_date   TEXT,                           -- 实际归还日期，NULL=未还
        renew_count   INTEGER NOT NULL DEFAULT 0,     -- 续借次数
        created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (book_id)   REFERENCES books(id),
        FOREIGN KEY (reader_id) REFERENCES readers(id)
      );

      CREATE UNIQUE INDEX ux_loans_active_book
        ON loans (book_id) WHERE return_date IS NULL;

      CREATE UNIQUE INDEX ux_loans_active_reader_book
        ON loans (reader_id, book_id) WHERE return_date IS NULL;
    `);
  },

  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS ux_loans_active_reader_book;
      DROP INDEX IF EXISTS ux_loans_active_book;
      DROP TABLE IF EXISTS loans;
    `);
    // SQLite >= 3.35 支持 DROP COLUMN；better-sqlite3 v11 自带的 SQLite 满足要求。
    db.exec('ALTER TABLE books DROP COLUMN total_loan_count;');
  },
};
