'use strict';

const express = require('express');
const bookService = require('../services/book-service');

// 书库管理路由（已有接口，保持不动）。
const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json(bookService.listBooks(q ? { q } : {}));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const book = bookService.getBook(Number(req.params.id));
    if (!book) return res.status(404).json({ error: '图书不存在' });
    res.json(book);
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const { book_no, title } = req.body || {};
    if (!book_no || typeof book_no !== 'string' || !book_no.trim()) {
      return res.status(400).json({ error: 'book_no 必填' });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title 必填' });
    }
    if (bookService.getBookByNo(book_no.trim())) {
      return res.status(409).json({ error: '书号已存在' });
    }
    const book = bookService.createBook({
      book_no: book_no.trim(),
      isbn: req.body.isbn,
      title: title.trim(),
      author: req.body.author,
      category: req.body.category,
    });
    res.status(201).json(book);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
