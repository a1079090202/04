'use strict';

const path = require('path');

const port = parseInt(process.env.PORT, 10) || 3000;
// :memory: 是 SQLite 的内存库特殊名（测试用），不能经 path.resolve 变成文件路径
const dbPath = process.env.LIBRARY_DB_PATH
  ? (process.env.LIBRARY_DB_PATH === ':memory:'
      ? ':memory:'
      : path.resolve(process.env.LIBRARY_DB_PATH))
  : path.resolve(__dirname, '..', 'data', 'library.db');

module.exports = { port, dbPath };
