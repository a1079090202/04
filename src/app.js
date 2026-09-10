'use strict';

const express = require('express');
const HttpError = require('./http-error');

const booksRouter = require('./routes/books');
const readersRouter = require('./routes/readers');
const loansRouter = require('./routes/loans');
const catalogRouter = require('./routes/catalog');

function createApp() {
  const app = express();
  app.use(express.json());

  // 健康检查
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // 已有模块（接口未改动）
  app.use('/api/books', booksRouter);
  app.use('/api/readers', readersRouter);

  // 本次新增模块
  app.use('/api/loans', loansRouter);
  app.use('/api/catalog', catalogRouter);

  // 兜底 404
  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // 统一错误处理：HttpError → 对应状态码，其余 → 500
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}

module.exports = createApp;
