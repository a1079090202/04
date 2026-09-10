'use strict';

const express = require('express');
const loanService = require('../services/loan-service');
const { loansToCsv } = require('../services/csv-export');

// 借阅管理路由：只做参数校验和转发，所有业务规则在 services/loan-service.js。
const router = express.Router();

/**
 * 借书：POST /api/loans
 * body: { book_no, card_no, due_date? }
 */
router.post('/', (req, res, next) => {
  try {
    const { book_no, card_no, due_date, loan_date } = req.body || {};
    if (!book_no || typeof book_no !== 'string' || !book_no.trim()) {
      return res.status(400).json({ error: 'book_no 必填（扫书号）' });
    }
    if (!card_no || typeof card_no !== 'string' || !card_no.trim()) {
      return res.status(400).json({ error: 'card_no 必填（扫读者证号）' });
    }
    const loan = loanService.checkout({
      book_no: book_no.trim(),
      card_no: card_no.trim(),
      due_date,
      loan_date, // 正常流程不传，仅测试/补录
    });
    res.status(201).json(loan);
  } catch (err) {
    next(err);
  }
});

/**
 * 借阅记录查询：GET /api/loans
 * 查询参数：reader_id | card_no, book_id | book_no, status, format=csv
 */
router.get('/', (req, res, next) => {
  try {
    const { reader_id, card_no, book_id, book_no, status, format } = req.query;
    const loans = loanService.listLoans({
      reader_id,
      reader_card: card_no,
      book_id,
      book_no,
      status,
    });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="loans.csv"');
      return res.send(loansToCsv(loans));
    }
    res.json(loans);
  } catch (err) {
    next(err);
  }
});

/** 逾期列表：GET /api/loans/overdue */
router.get('/overdue', (req, res, next) => {
  try {
    res.json(loanService.listOverdue());
  } catch (err) {
    next(err);
  }
});

/** 扫书号定位当前未归还记录（还书台场景）：GET /api/loans/by-book/:bookNo */
router.get('/by-book/:bookNo', (req, res, next) => {
  try {
    res.json(loanService.findActiveLoanByBookNo(req.params.bookNo));
  } catch (err) {
    next(err);
  }
});

/** 单条借阅记录：GET /api/loans/:id */
router.get('/:id', (req, res, next) => {
  try {
    res.json(loanService.getLoan(req.params.id));
  } catch (err) {
    next(err);
  }
});

/** 续借：POST /api/loans/:id/renew  body: { days? } 或 { due_date? } */
router.post('/:id/renew', (req, res, next) => {
  try {
    const { days, due_date } = req.body || {};
    if (days !== undefined && days !== null) {
      const n = Number(days);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({ error: 'days 必须是正整数' });
      }
    }
    res.json(loanService.renew(req.params.id, { days, due_date }));
  } catch (err) {
    next(err);
  }
});

/** 归还：POST /api/loans/:id/return  body: { return_date? } */
router.post('/:id/return', (req, res, next) => {
  try {
    const { return_date } = req.body || {};
    res.json(loanService.returnLoan(req.params.id, { return_date }));
  } catch (err) {
    next(err);
  }
});

/** 管理员改应还日期：PATCH /api/loans/:id/due  body: { due_date } */
router.patch('/:id/due', (req, res, next) => {
  try {
    const { due_date } = req.body || {};
    if (!due_date || typeof due_date !== 'string') {
      return res.status(400).json({ error: 'due_date 必填，格式 YYYY-MM-DD' });
    }
    res.json(loanService.updateDueDate(req.params.id, due_date));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
