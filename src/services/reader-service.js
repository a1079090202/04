'use strict';

const db = require('../db');

// 读者档案（借阅模块上线前已存在）。按约定不随借阅功能改动。
function listReaders({ q } = {}) {
  if (q) {
    const like = `%${q}%`;
    return db.prepare(`
      SELECT * FROM readers
      WHERE card_no LIKE ? OR name LIKE ? OR phone LIKE ?
      ORDER BY id
    `).all(like, like, like);
  }
  return db.prepare('SELECT * FROM readers ORDER BY id').all();
}

function getReader(id) {
  return db.prepare('SELECT * FROM readers WHERE id = ?').get(id);
}

function getReaderByCardNo(cardNo) {
  return db.prepare('SELECT * FROM readers WHERE card_no = ?').get(cardNo);
}

function createReader({ card_no, name, phone }) {
  const info = db.prepare(`
    INSERT INTO readers (card_no, name, phone) VALUES (?, ?, ?)
  `).run(card_no, name, phone || null);
  return getReader(info.lastInsertRowid);
}

module.exports = { listReaders, getReader, getReaderByCardNo, createReader };
