'use strict';

const express = require('express');
const readerService = require('../services/reader-service');

// 读者档案路由（已有接口，保持不动）。
const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json(readerService.listReaders(q ? { q } : {}));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const reader = readerService.getReader(Number(req.params.id));
    if (!reader) return res.status(404).json({ error: '读者不存在' });
    res.json(reader);
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const { card_no, name } = req.body || {};
    if (!card_no || typeof card_no !== 'string' || !card_no.trim()) {
      return res.status(400).json({ error: 'card_no 必填' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name 必填' });
    }
    if (readerService.getReaderByCardNo(card_no.trim())) {
      return res.status(409).json({ error: '读者证号已存在' });
    }
    const reader = readerService.createReader({
      card_no: card_no.trim(),
      name: name.trim(),
      phone: req.body.phone,
    });
    res.status(201).json(reader);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
