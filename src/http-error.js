'use strict';

// 带 HTTP 状态码的业务错误。service 层抛出，路由/错误处理中间件统一转成响应。
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

module.exports = HttpError;
