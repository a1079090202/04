'use strict';

/**
 * 本地日期工具。
 *
 * 硬性约定：借阅相关日期一律用“本地日历日”的 YYYY-MM-DD 字符串，
 * 不使用 UTC 时间戳，避免服务器时区与图书室所在地不一致时
 * 逾期判定提前/延后一天（例如 UTC 服务器在本地晚上 8 点就翻到了第二天）。
 *
 * today() 取本地时区下的年/月/日拼装，整个服务的“今天”只从这里出。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 可替换的时钟，仅用于测试里把“今天”拨到任意日期；生产环境不调用。
let clock = null;

function today() {
  const d = clock ? new Date(clock) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 测试专用：固定“今天”为某个 YYYY-MM-DD */
function __setTodayForTest(dateStr) {
  clock = dateStr;
}

/** 测试专用：恢复真实时钟 */
function __resetClockForTest() {
  clock = null;
}

/** 严格校验 YYYY-MM-DD，且必须是真实存在的日历日（拒绝 2026-02-30 这类） */
function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 日期加 n 天，返回 YYYY-MM-DD（纯字符串运算，不涉及时区） */
function addDays(dateStr, n) {
  if (!isValidDate(dateStr)) throw new Error(`非法日期：${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/**
 * 两个日期相差几天：b - a。
 * 例如 diffDays('2026-09-10', '2026-09-13') === 3
 */
function diffDays(a, b) {
  if (!isValidDate(a) || !isValidDate(b)) throw new Error('非法日期');
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / 86400000);
}

module.exports = {
  today,
  addDays,
  diffDays,
  isValidDate,
  __setTodayForTest,
  __resetClockForTest,
};
