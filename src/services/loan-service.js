'use strict';

/**
 * 借阅服务：借书 → 应还 → 续借 → 归还 → 逾期 的全部业务规则都在这里。
 * 路由层只做参数校验和转发，不允许把业务判断写进路由。
 *
 * 日期约定见 services/date-util.js：全部按本地日历日比较。
 */

const db = require('../db');
const HttpError = require('../http-error');
const dateUtil = require('./date-util');
const bookService = require('./book-service');
const readerService = require('./reader-service');

const DEFAULT_LOAN_DAYS = 14; // 默认借期：借书日起 14 天
const DUE_SOON_DAYS = 3;     // 到期前 3 天标记“即将到期”

// 借阅状态：
//   on_loan   在借（离到期还早）
//   due_soon  即将到期（含到期当天，0~3 天）
//   overdue   已逾期（超过应还日仍未还）
//   returned  已归还
const STATUSES = ['on_loan', 'due_soon', 'overdue', 'returned'];

function computeStatus(row, todayStr = dateUtil.today()) {
  if (row.return_date) return 'returned';
  const daysLeft = dateUtil.diffDays(todayStr, row.due_date);
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= DUE_SOON_DAYS) return 'due_soon';
  return 'on_loan';
}

function decorate(row, todayStr = dateUtil.today()) {
  if (!row) return null;
  const status = computeStatus(row, todayStr);
  return {
    ...row,
    status,
    // 未归还时给出距应还日的天数：正数=还剩几天，0=今天到期，负数=已逾期几天
    days_until_due: row.return_date ? null : dateUtil.diffDays(todayStr, row.due_date),
    is_overdue: status === 'overdue',
  };
}

function findActiveLoanByBook(bookId) {
  return db.prepare(`
    SELECT * FROM loans WHERE book_id = ? AND return_date IS NULL
  `).get(bookId);
}

function findActiveLoanByReaderBook(readerId, bookId) {
  return db.prepare(`
    SELECT * FROM loans
    WHERE reader_id = ? AND book_id = ? AND return_date IS NULL
  `).get(readerId, bookId);
}

function getLoanOrThrow(loanId) {
  const id = Number(loanId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'loan_id 非法');
  const row = db.prepare(`
    SELECT l.*, b.book_no, b.title,
           r.card_no AS reader_card, r.name AS reader_name
    FROM loans l
    JOIN books b   ON b.id = l.book_id
    JOIN readers r ON r.id = l.reader_id
    WHERE l.id = ?
  `).get(id);
  if (!row) throw new HttpError(404, '借阅记录不存在');
  return row;
}

/**
 * 借书（扫码场景：书号 + 读者证号）。
 *
 * @param {object} p
 * @param {string} p.book_no    扫出的书号
 * @param {string} p.card_no    扫出的读者证号
 * @param {string} [p.due_date] 管理员指定应还日 YYYY-MM-DD（不给则借书日 +14 天）
 * @param {string} [p.loan_date] 仅测试/补录使用，默认今天
 */
function checkout({ book_no, card_no, due_date, loan_date }) {
  if (!book_no || typeof book_no !== 'string') {
    throw new HttpError(400, 'book_no 必填');
  }
  if (!card_no || typeof card_no !== 'string') {
    throw new HttpError(400, 'card_no 必填');
  }

  const book = bookService.getBookByNo(book_no.trim());
  if (!book) throw new HttpError(404, `书号 ${book_no} 不存在`);

  const reader = readerService.getReaderByCardNo(card_no.trim());
  if (!reader) throw new HttpError(404, `读者证号 ${card_no} 不存在`);

  const lDate = loan_date || dateUtil.today();
  if (!dateUtil.isValidDate(lDate)) throw new HttpError(400, 'loan_date 非法');

  let dDate;
  if (due_date !== undefined && due_date !== null && due_date !== '') {
    if (!dateUtil.isValidDate(due_date)) {
      throw new HttpError(400, 'due_date 非法，应为 YYYY-MM-DD');
    }
    dDate = due_date;
    if (dateUtil.diffDays(lDate, dDate) < 0) {
      throw new HttpError(400, '应还日期不能早于借书日期');
    }
  } else {
    dDate = dateUtil.addDays(lDate, DEFAULT_LOAN_DAYS);
  }

  // 业务校验，给出明确的中文拒绝原因（数据库还有唯一索引兜底并发）。
  if (findActiveLoanByBook(book.id)) {
    throw new HttpError(409, '该书已借出且尚未归还，不能重复借出');
  }
  if (findActiveLoanByReaderBook(reader.id, book.id)) {
    throw new HttpError(409, '该读者已借此书且尚未归还，不能重复借阅同一本书');
  }

  const insertLoan = db.prepare(`
    INSERT INTO loans (book_id, reader_id, loan_date, due_date)
    VALUES (?, ?, ?, ?)
  `);
  const bumpCount = db.prepare(
    'UPDATE books SET total_loan_count = total_loan_count + 1 WHERE id = ?'
  );

  const tx = db.transaction(() => {
    const info = insertLoan.run(book.id, reader.id, lDate, dDate);
    bumpCount.run(book.id);
    return info.lastInsertRowid;
  });

  let loanId;
  try {
    loanId = tx();
  } catch (err) {
    // 并发下被部分唯一索引拦截
    if (String(err.message).includes('UNIQUE')) {
      throw new HttpError(409, '该书已借出或该读者已借此书且未归还');
    }
    throw err;
  }

  return decorate(getLoanOrThrow(loanId));
}

/**
 * 续借：只能对未归还记录操作。新应还日默认“今天起 +14 天”，
 * 管理员可用 days 改天数，或直接给 due_date。
 * 逾期记录也允许续借，续到未来日期后逾期标记自然消失。
 */
function renew(loanId, { days, due_date } = {}) {
  const loan = getLoanOrThrow(loanId);
  if (loan.return_date) throw new HttpError(409, '该书已归还，不能续借');

  const todayStr = dateUtil.today();
  let newDue;
  if (due_date !== undefined && due_date !== null && due_date !== '') {
    if (!dateUtil.isValidDate(due_date)) {
      throw new HttpError(400, 'due_date 非法，应为 YYYY-MM-DD');
    }
    newDue = due_date;
  } else {
    let n = DEFAULT_LOAN_DAYS;
    if (days !== undefined && days !== null) {
      n = Number(days);
      if (!Number.isInteger(n) || n <= 0) {
        throw new HttpError(400, 'days 必须是正整数');
      }
    }
    // 若应还日还在未来，从原应还日顺延；已逾期则从今天起算。
    const base = dateUtil.diffDays(todayStr, loan.due_date) > 0 ? loan.due_date : todayStr;
    newDue = dateUtil.addDays(base, n);
  }
  if (dateUtil.diffDays(loan.loan_date, newDue) < 0) {
    throw new HttpError(400, '续借后的应还日期不能早于借书日期');
  }

  db.prepare(`
    UPDATE loans
       SET due_date = ?, renew_count = renew_count + 1
     WHERE id = ? AND return_date IS NULL
  `).run(newDue, loan.id);

  return decorate(getLoanOrThrow(loan.id));
}

/**
 * 归还：记实际归还日期（默认今天，可补录），只能还一次。
 */
function returnLoan(loanId, { return_date } = {}) {
  const loan = getLoanOrThrow(loanId);
  if (loan.return_date) {
    throw new HttpError(409, `该书已于 ${loan.return_date} 归还，不能重复归还`);
  }

  const rDate = return_date || dateUtil.today();
  if (!dateUtil.isValidDate(rDate)) {
    throw new HttpError(400, 'return_date 非法，应为 YYYY-MM-DD');
  }
  if (dateUtil.diffDays(loan.loan_date, rDate) < 0) {
    throw new HttpError(400, '实际归还日期不能早于借书日期');
  }

  db.prepare('UPDATE loans SET return_date = ? WHERE id = ?').run(rDate, loan.id);
  return decorate(getLoanOrThrow(loan.id));
}

/** 管理员修改应还日期（仅未归还记录） */
function updateDueDate(loanId, due_date) {
  const loan = getLoanOrThrow(loanId);
  if (loan.return_date) throw new HttpError(409, '该书已归还，不能改应还日期');
  if (!dateUtil.isValidDate(due_date)) {
    throw new HttpError(400, 'due_date 非法，应为 YYYY-MM-DD');
  }
  if (dateUtil.diffDays(loan.loan_date, due_date) < 0) {
    throw new HttpError(400, '应还日期不能早于借书日期');
  }
  db.prepare('UPDATE loans SET due_date = ? WHERE id = ?').run(due_date, loan.id);
  return decorate(getLoanOrThrow(loan.id));
}

function getLoan(loanId) {
  return decorate(getLoanOrThrow(loanId));
}

/** 通过在借书号定位未归还记录（管理员还书时直接扫书号的场景） */
function findActiveLoanByBookNo(bookNo) {
  const book = bookService.getBookByNo(String(bookNo).trim());
  if (!book) throw new HttpError(404, `书号 ${bookNo} 不存在`);
  const row = db.prepare(`
    SELECT l.*, b.book_no, b.title,
           r.card_no AS reader_card, r.name AS reader_name
    FROM loans l
    JOIN books b   ON b.id = l.book_id
    JOIN readers r ON r.id = l.reader_id
    WHERE l.book_id = ? AND l.return_date IS NULL
  `).get(book.id);
  if (!row) throw new HttpError(404, '该书没有未归还的借阅记录');
  return decorate(row);
}

const LIST_SQL = `
  SELECT l.*, b.book_no, b.title,
         r.card_no AS reader_card, r.name AS reader_name
  FROM loans l
  JOIN books b   ON b.id = l.book_id
  JOIN readers r ON r.id = l.reader_id
  WHERE (@reader_id IS NULL OR l.reader_id = @reader_id)
    AND (@book_id   IS NULL OR l.book_id   = @book_id)
  ORDER BY
    CASE WHEN l.return_date IS NULL THEN 0 ELSE 1 END,
    l.due_date ASC,
    l.id DESC
`;

/**
 * 借阅记录查询，可按读者 / 书 / 状态筛。
 * 支持传内部 id，也支持直接传扫描得到的 card_no / book_no。
 * status: on_loan | due_soon | overdue | returned
 */
function listLoans({ reader_id, reader_card, book_id, book_no, status } = {}) {
  const params = { reader_id: null, book_id: null };

  if (reader_id !== undefined && reader_id !== null && reader_id !== '') {
    params.reader_id = Number(reader_id);
  } else if (reader_card) {
    const reader = readerService.getReaderByCardNo(String(reader_card).trim());
    if (!reader) throw new HttpError(404, `读者证号 ${reader_card} 不存在`);
    params.reader_id = reader.id;
  }

  if (book_id !== undefined && book_id !== null && book_id !== '') {
    params.book_id = Number(book_id);
  } else if (book_no) {
    const book = bookService.getBookByNo(String(book_no).trim());
    if (!book) throw new HttpError(404, `书号 ${book_no} 不存在`);
    params.book_id = book.id;
  }

  if (status !== undefined && status !== null && status !== '') {
    if (!STATUSES.includes(status)) {
      throw new HttpError(400, `status 非法，可选：${STATUSES.join(' / ')}`);
    }
  }

  const todayStr = dateUtil.today();
  const rows = db.prepare(LIST_SQL).all(params).map((r) => decorate(r, todayStr));
  return status ? rows.filter((r) => r.status === status) : rows;
}

/** 逾期列表（管理员首页用） */
function listOverdue() {
  return listLoans({ status: 'overdue' });
}

module.exports = {
  STATUSES,
  DEFAULT_LOAN_DAYS,
  DUE_SOON_DAYS,
  computeStatus,
  decorate,
  checkout,
  renew,
  returnLoan,
  updateDueDate,
  getLoan,
  findActiveLoanByBookNo,
  listLoans,
  listOverdue,
};
