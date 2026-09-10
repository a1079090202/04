'use strict';

/**
 * 借阅记录导出 CSV。
 * 带 UTF-8 BOM，保证管理员用 Excel 直接打开中文不乱码。
 */

const STATUS_LABELS = {
  on_loan: '在借',
  due_soon: '即将到期',
  overdue: '逾期',
  returned: '已归还',
};

const HEADERS = [
  '借阅ID', '书号', '书名', '读者证号', '读者姓名',
  '借出日期', '应还日期', '实际归还日期', '续借次数', '状态', '距应还天数',
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function loansToCsv(loans) {
  const lines = [HEADERS.join(',')];
  for (const l of loans) {
    lines.push([
      l.id,
      l.book_no,
      l.title,
      l.reader_card,
      l.reader_name,
      l.loan_date,
      l.due_date,
      l.return_date || '',
      l.renew_count,
      STATUS_LABELS[l.status] || l.status,
      l.days_until_due === null ? '' : l.days_until_due,
    ].map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // UTF-8 BOM 防 Excel 乱码，CRLF 行尾
}

module.exports = { loansToCsv, STATUS_LABELS };
