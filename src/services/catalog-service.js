'use strict';

/**
 * 读者查书目录（新增模块，不动已有的书库管理接口）。
 * 在 books 数据之上叠加实时在馆状态：在馆 / 借出、借给谁、预计多久能还。
 */

const db = require('../db');
const bookService = require('./book-service');
const loanService = require('./loan-service');
const dateUtil = require('./date-util');

function withAvailability(book, todayStr = dateUtil.today()) {
  if (!book) return null;
  const active = db.prepare(`
    SELECT l.id AS loan_id, l.due_date,
           r.card_no AS reader_card, r.name AS reader_name
    FROM loans l
    JOIN readers r ON r.id = l.reader_id
    WHERE l.book_id = ? AND l.return_date IS NULL
  `).get(book.id);

  if (!active) {
    return {
      ...book,
      loan_status: 'available',
      on_loan: false,
      active_loan: null,
    };
  }

  return {
    ...book,
    loan_status: 'on_loan',
    on_loan: true,
    active_loan: {
      loan_id: active.loan_id,
      reader_card: active.reader_card,
      reader_name: active.reader_name,
      due_date: active.due_date,
      days_until_due: dateUtil.diffDays(todayStr, active.due_date),
    },
  };
}

/** 读者查书：关键字检索 + 每本书的在馆状态 */
function searchCatalog({ q } = {}) {
  const books = bookService.listBooks(q ? { q } : {});
  const todayStr = dateUtil.today();
  return books.map((b) => withAvailability(b, todayStr));
}

/** 按书号查单本的在馆情况 */
function getCatalogByBookNo(bookNo) {
  return withAvailability(bookService.getBookByNo(String(bookNo).trim()));
}

module.exports = { searchCatalog, getCatalogByBookNo, withAvailability };
