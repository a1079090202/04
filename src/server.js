'use strict';

const createApp = require('./app');
const { port } = require('./config');
const { up } = require('./db/migrate');

// 启动前自动执行迁移（幂等），也可以手动用 npm run migrate 单独执行。
up({ silent: true });

const app = createApp();
app.listen(port, () => {
  console.log(`社区图书室服务已启动：http://localhost:${port}`);
});
