'use strict';

/**
 * 初始版本：书库（books）与读者档案（readers）。
 * 这是借阅模块上线前系统里已有的两张表。
 */
module.exports = {
  id: 1,
  name: 'initial_books_readers',

  up(db) {
    db.exec(`
      CREATE TABLE books (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        book_no     TEXT NOT NULL UNIQUE,            -- 书号 / 条形码（借书时扫描）
        isbn        TEXT,
        title       TEXT NOT NULL,                   -- 书名
        author      TEXT,                            -- 作者
        category    TEXT,                            -- 分类
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE readers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        card_no     TEXT NOT NULL UNIQUE,            -- 读者证号（借书时扫描）
        name        TEXT NOT NULL,                   -- 姓名
        phone       TEXT,                            -- 电话
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
    `);
  },

  down(db) {
    db.exec(`
      DROP TABLE IF EXISTS readers;
      DROP TABLE IF EXISTS books;
    `);
  },
};
