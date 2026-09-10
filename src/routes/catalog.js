'use strict';

const express = require('express');
const catalogService = require('../services/catalog-service');
const HttpError = require('../http-error');

// 读者查书目录（新增）：看书是否在馆、借出后预计多久能还。
const router = express.Router();

/** GET /api/catalog?q=关键字 */
router.get('/', (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json(catalogService.searchCatalog(q ? { q } : {}));
  } catch (err) {
    next(err);
  }
});

/** GET /api/catalog/book/:bookNo —— 按书号查在馆状态 */
router.get('/book/:bookNo', (req, res, next) => {
  try {
    const item = catalogService.getCatalogByBookNo(req.params.bookNo);
    if (!item) throw new HttpError(404, `书号 ${req.params.bookNo} 不存在`);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
