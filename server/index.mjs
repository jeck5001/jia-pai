import { createApp } from './app.mjs';

const { config, server } = await createApp();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`小卖部查价服务已启动：http://0.0.0.0:${config.port}`);
});
