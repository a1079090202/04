'use strict';

/**
 * 借阅模块全链测试：借书 → 应还 → 即将到期/逾期 → 续借 → 归还 → 再借。
 * 同时回归已有的书库/读者/查书接口。
 *
 * 用内存 SQLite + 可控的“本地今天”，不依赖真实日历和服务器时区。
 * 运行：npm test
 */

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.LIBRARY_DB_PATH = ':memory:';

const db = require('../src/db');
const { up, down } = require('../src/db/migrate');
const dateUtil = require('../src/services/date-util');
const createApp = require('../src/app');

let baseUrl;
let server;

async function http(method, urlPath, body) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { /* csv 等非 JSON 响应 */ }
  }
  return { status: res.status, json, text, headers: res.headers };
}

// 固定一组日历日（年份无所谓，只关心相对关系）
const D0 = '2026-09-10';       // “今天”：借书日
const D14 = '2026-09-24';      // 默认应还日（+14 天）
const D11 = '2026-09-21';      // 还剩 3 天：即将到期
const D14plus = '2026-09-25';  // 逾期第 1 天

async function seedBook(bookNo = 'B001', title = '社区图书馆指南') {
  const r = await http('POST', '/api/books', {
    book_no: bookNo, isbn: '978-0-00-000000-0', title, author: '张三', category: '工具书',
  });
  assert.equal(r.status, 201);
  return r.json;
}

async function seedReader(cardNo = 'R001', name = '李四') {
  const r = await http('POST', '/api/readers', { card_no: cardNo, name, phone: '13800000000' });
  assert.equal(r.status, 201);
  return r.json;
}

function resetData() {
  db.exec(`
    DELETE FROM loans;
    DELETE FROM books;
    DELETE FROM readers;
    DELETE FROM sqlite_sequence WHERE name IN ('loans', 'books', 'readers');
  `);
}

describe('借阅管理全流程', () => {
  before(async () => {
    up({ silent: true });
    const app = createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    dateUtil.__resetClockForTest();
  });

  beforeEach(() => {
    resetData();
    dateUtil.__resetClockForTest();
  });

  it('迁移 down 可以完整回滚借阅表（迁移脚本自检）', () => {
    // 只验证迁移文件本身可回滚，回滚完立刻重建，不影响后续测试
    down(1); // ↓ 002
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'").get(), undefined);
    assert.throws(() => db.prepare('SELECT total_loan_count FROM books LIMIT 1').get());
    up({ silent: true }); // ↑ 002
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'").get());
  });

  it('回归：书库管理、读者档案、查书接口在借阅模块上线后照常工作', async () => {
    const book = await seedBook('B-REG', '回归测试之书');
    assert.equal(book.total_loan_count, 0); // 新增列已存在，旧接口 SELECT * 自然带出

    await seedReader('R-REG', '回归读者');

    const list = await http('GET', '/api/books?q=回归');
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].book_no, 'B-REG');

    const readers = await http('GET', '/api/readers?q=回归读者');
    assert.equal(readers.json[0].card_no, 'R-REG');

    const catalog = await http('GET', '/api/catalog?q=回归');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json[0].loan_status, 'available');
    assert.equal(catalog.json[0].on_loan, false);
  });

  it('借书：扫码书号+读者证号，默认应还日为本地借书日+14天，累计借出次数+1', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();

    const r = await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.loan_date, D0);
    assert.equal(r.json.due_date, D14);
    assert.equal(r.json.status, 'on_loan');
    assert.equal(r.json.days_until_due, 14);
    assert.equal(r.json.return_date, null);
    assert.equal(r.json.renew_count, 0);

    const book = await http('GET', '/api/books/1');
    assert.equal(book.json.total_loan_count, 1);
  });

  it('借书时管理员可以直接指定应还日期，非法/早于借书日被拒', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();

    const ok = await http('POST', '/api/loans', {
      book_no: 'B001', card_no: 'R001', due_date: '2026-10-01',
    });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.due_date, '2026-10-01');

    const bad = await http('POST', '/api/loans', {
      book_no: 'B001', card_no: 'R001', due_date: '2026-02-30',
    });
    assert.equal(bad.status, 400);

    const early = await http('POST', '/api/loans', {
      book_no: 'B001', card_no: 'R001', due_date: '2026-09-01',
    });
    assert.equal(early.status, 400);
  });

  it('同一本书未归还不能再借出；同一读者同一本书未还不能重复借', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader('R001', '李四');
    await seedReader('R002', '王五');

    const first = await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' });
    assert.equal(first.status, 201);

    // 同一读者同一本书
    const sameReader = await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' });
    assert.equal(sameReader.status, 409);

    // 换个读者也不行（书只有一本，已被借走）
    const otherReader = await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R002' });
    assert.equal(otherReader.status, 409);

    // 读者可以借另一本书
    await seedBook('B002', '另一本书');
    const secondBook = await http('POST', '/api/loans', { book_no: 'B002', card_no: 'R001' });
    assert.equal(secondBook.status, 201);

    // 被拒的借阅不能虚增累计次数
    const b1 = (await http('GET', '/api/books/1')).json;
    assert.equal(b1.total_loan_count, 1);
  });

  it('读者查书：借出后显示在馆状态、借阅人和预计归还时间', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' });

    const item = await http('GET', '/api/catalog/book/B001');
    assert.equal(item.status, 200);
    assert.equal(item.json.loan_status, 'on_loan');
    assert.equal(item.json.on_loan, true);
    assert.equal(item.json.active_loan.due_date, D14);
    assert.equal(item.json.active_loan.days_until_due, 14);
    assert.equal(item.json.active_loan.reader_card, 'R001');
  });

  it('到期前3天自动标记「即将到期」，逾期自动标记「逾期」', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;

    dateUtil.__setTodayForTest(D11); // 距应还 3 天
    let detail = (await http('GET', `/api/loans/${loan.id}`)).json;
    assert.equal(detail.status, 'due_soon');
    assert.equal(detail.days_until_due, 3);

    dateUtil.__setTodayForTest(D14); // 到期当天仍算即将到期
    detail = (await http('GET', `/api/loans/${loan.id}`)).json;
    assert.equal(detail.status, 'due_soon');
    assert.equal(detail.days_until_due, 0);

    dateUtil.__setTodayForTest(D14plus); // 超过应还日
    detail = (await http('GET', `/api/loans/${loan.id}`)).json;
    assert.equal(detail.status, 'overdue');
    assert.equal(detail.is_overdue, true);
    assert.equal(detail.days_until_due, -1);

    const overdueList = await http('GET', '/api/loans/overdue');
    assert.equal(overdueList.json.length, 1);
    assert.equal(overdueList.json[0].id, loan.id);
  });

  it('续借：应还日从原应还日顺延14天、续借次数+1；逾期后续借可解除逾期', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;
    assert.equal(loan.due_date, D14);

    const renewed = await http('POST', `/api/loans/${loan.id}/renew`, {});
    assert.equal(renewed.status, 200, renewed.text);
    assert.equal(renewed.json.due_date, '2026-10-08'); // 原应还 09-24 + 14
    assert.equal(renewed.json.renew_count, 1);
    assert.equal(renewed.json.status, 'on_loan');

    // 逾期后续借：超过当前应还日(10-08)后，基准改为“今天”
    dateUtil.__setTodayForTest('2026-10-09');
    const afterOverdue = await http('POST', `/api/loans/${loan.id}/renew`, { days: 7 });
    assert.equal(afterOverdue.json.due_date, '2026-10-16');
    assert.equal(afterOverdue.json.renew_count, 2);
    assert.equal(afterOverdue.json.status, 'on_loan');

    // 已归还的不能续借
    const ret = await http('POST', `/api/loans/${loan.id}/return`, {});
    assert.equal(ret.status, 200);
    const renewAgain = await http('POST', `/api/loans/${loan.id}/renew`, {});
    assert.equal(renewAgain.status, 409);
  });

  it('归还：记实际归还日期，重复归还被拒；归还后同一读者可以再借且累计次数增加', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;

    dateUtil.__setTodayForTest('2026-09-20');
    const returned = await http('POST', `/api/loans/${loan.id}/return`, {});
    assert.equal(returned.status, 200);
    assert.equal(returned.json.return_date, '2026-09-20');
    assert.equal(returned.json.status, 'returned');
    assert.equal(returned.json.days_until_due, null);

    const twice = await http('POST', `/api/loans/${loan.id}/return`, {});
    assert.equal(twice.status, 409);

    // 书回到在馆状态
    const cat = await http('GET', '/api/catalog/book/B001');
    assert.equal(cat.json.loan_status, 'available');

    // 同一读者可再次借同一本书，累计次数变为 2
    dateUtil.__setTodayForTest('2026-09-21');
    const second = await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' });
    assert.equal(second.status, 201);
    const book = (await http('GET', '/api/books/1')).json;
    assert.equal(book.total_loan_count, 2);
  });

  it('管理员修改应还日期，且不能改成早于借书日', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;

    const patched = await http('PATCH', `/api/loans/${loan.id}/due`, { due_date: '2026-10-15' });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.due_date, '2026-10-15');

    const bad = await http('PATCH', `/api/loans/${loan.id}/due`, { due_date: '2026-09-01' });
    assert.equal(bad.status, 400);

    const missing = await http('PATCH', `/api/loans/${loan.id}/due`, {});
    assert.equal(missing.status, 400);
  });

  it('借阅记录可按读者、按书、按状态筛选', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook('B001');
    await seedBook('B002');
    await seedReader('R001', '李四');
    await seedReader('R002', '王五');

    const l1 = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;
    await http('POST', '/api/loans', { book_no: 'B002', card_no: 'R002' });
    await http('POST', `/api/loans/${l1.id}/return`, {});

    const byReader = await http('GET', '/api/loans?card_no=R001');
    assert.equal(byReader.json.length, 1);
    assert.equal(byReader.json[0].book_no, 'B001');

    const byBook = await http('GET', '/api/loans?book_no=B002');
    assert.equal(byBook.json.length, 1);
    assert.equal(byBook.json[0].reader_card, 'R002');

    const onLoan = await http('GET', '/api/loans?status=on_loan');
    assert.equal(onLoan.json.length, 1);
    assert.equal(onLoan.json[0].book_no, 'B002');

    const returned = await http('GET', '/api/loans?status=returned');
    assert.equal(returned.json.length, 1);
    assert.equal(returned.json[0].id, l1.id);

    const badStatus = await http('GET', '/api/loans?status=nope');
    assert.equal(badStatus.status, 400);
  });

  it('导出 CSV：含表头、BOM 和中文状态', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook('B001', 'CSV测试书');
    await seedReader('R001', 'CSV读者');
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;
    await http('POST', `/api/loans/${loan.id}/return`, {});

    const r = await http('GET', '/api/loans?format=csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    // fetch 的 text() 会按 WHATWG 规范剥掉 UTF-8 BOM，所以直接看原始字节
    const raw = Buffer.from(await (await fetch(baseUrl + '/api/loans?format=csv')).arrayBuffer());
    assert.deepEqual([raw[0], raw[1], raw[2]], [0xEF, 0xBB, 0xBF], 'CSV 应以 UTF-8 BOM 开头');
    assert.ok(r.text.includes('借阅ID'));
    assert.ok(r.text.includes('B001'));
    assert.ok(r.text.includes('CSV读者'));
    assert.ok(r.text.includes('已归还'));
  });

  it('扫书号定位在借记录，还书台可直接用书号完成归还', async () => {
    dateUtil.__setTodayForTest(D0);
    await seedBook();
    await seedReader();
    const loan = (await http('POST', '/api/loans', { book_no: 'B001', card_no: 'R001' })).json;

    const found = await http('GET', '/api/loans/by-book/B001');
    assert.equal(found.status, 200);
    assert.equal(found.json.id, loan.id);

    const ret = await http('POST', `/api/loans/${found.json.id}/return`, {});
    assert.equal(ret.status, 200);
    assert.equal(ret.json.status, 'returned');

    const notFound = await http('GET', '/api/loans/by-book/B001');
    assert.equal(notFound.status, 404);
  });

  it('错误输入：缺参数、不存在的书号/证号、不存在的记录', async () => {
    const noBook = await http('POST', '/api/loans', { card_no: 'X' });
    assert.equal(noBook.status, 400);
    const noCard = await http('POST', '/api/loans', { book_no: 'X' });
    assert.equal(noCard.status, 400);

    const unknownBook = await http('POST', '/api/loans', { book_no: 'NOPE', card_no: 'NOPE' });
    assert.equal(unknownBook.status, 404);

    const unknownLoan = await http('GET', '/api/loans/9999');
    assert.equal(unknownLoan.status, 404);
  });
});

describe('本地日期工具（不依赖服务器时区的字符串日运算）', () => {
  it('addDays / diffDays 正确跨月跨年', () => {
    assert.equal(dateUtil.addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(dateUtil.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(dateUtil.addDays('2026-09-10', 14), '2026-09-24');
    assert.equal(dateUtil.diffDays('2026-09-24', '2026-09-25'), 1);
    assert.equal(dateUtil.diffDays('2026-09-25', '2026-09-24'), -1);
  });

  it('isValidDate 拒绝不存在的日期和错误格式', () => {
    assert.ok(dateUtil.isValidDate('2026-02-28'));
    assert.ok(!dateUtil.isValidDate('2026-02-30'));
    assert.ok(!dateUtil.isValidDate('2026-13-01'));
    assert.ok(!dateUtil.isValidDate('2026/09/10'));
    assert.ok(!dateUtil.isValidDate('not-a-date'));
  });

  it('today() 产出本地日历日 YYYY-MM-DD', () => {
    dateUtil.__setTodayForTest('2026-03-05');
    assert.equal(dateUtil.today(), '2026-03-05');
    dateUtil.__resetClockForTest();
    assert.match(dateUtil.today(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
