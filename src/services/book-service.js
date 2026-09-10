'use strict';

const db = require('../db');

// 书库管理（借阅模块上线前已存在）。
// 注意：按约定本文件属于"已有接口"，借阅功能不得改动这里的函数签名。
function listBooks({ q } = {}) {
  if (q) {
    const like = `%${q}%`;
    return db.prepare(`
      SELECT * FROM books
      WHERE book_no LIKE ? OR title LIKE ? OR author LIKE ? OR category LIKE ?
      ORDER BY id
    `).all(like, like, like, like);
  }
  return db.prepare('SELECT * FROM books ORDER BY id').all();
}

function getBook(id) {
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}

function getBookByNo(bookNo) {
  return db.prepare('SELECT * FROM books WHERE book_no = ?').get(bookNo);
}

function createBook({ book_no, isbn, title, author, category }) {
  const info = db.prepare(`
    INSERT INTO books (book_no, isbn, title, author, category)
    VALUES (?, ?, ?, ?, ?)
  `).run(book_no, isbn || null, title, author || null, category || null);
  return getBook(info.lastInsertRowid);
}

module.exports = { listBooks, getBook, getBookByNo, createBook };
