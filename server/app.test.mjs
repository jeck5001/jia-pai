import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runningApp(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'xiaomaibu-server-'));
  temporaryDirectories.push(dataDir);
  const { server } = await createApp({ dataDir, adminToken: 'publish-token', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    dataDir,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe('一体化服务', () => {
  it('在数据目录初始化空价格表，并仅允许持有管理员口令的发布请求更新它', async () => {
    const app = await runningApp();
    try {
      const initialResponse = await fetch(`${app.baseUrl}/api/catalog`);
      const initialCatalog = await initialResponse.json();
      expect(initialResponse.status).toBe(200);
      expect(initialCatalog).toEqual({
        version: 'empty',
        effectiveAt: null,
        sourceLabel: '尚未导入价格表',
        products: [],
      });
      expect(JSON.parse(await readFile(join(app.dataDir, 'products.json'), 'utf8'))).toEqual(initialCatalog);

      const catalog = {
        version: 'published-20260728',
        effectiveAt: '2026-07-28T00:00:00.000Z',
        sourceLabel: '服务端测试',
        products: [{ id: 'test-item', name: '测试商品', priceCents: 1200, active: true }],
      };
      const deniedResponse = await fetch(`${app.baseUrl}/api/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      expect(deniedResponse.status).toBe(401);

      const publishResponse = await fetch(`${app.baseUrl}/api/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'publish-token' },
        body: JSON.stringify(catalog),
      });
      expect(publishResponse.status).toBe(200);
      expect((await (await fetch(`${app.baseUrl}/api/catalog`)).json()).products).toEqual(catalog.products);
    } finally {
      await app.close();
    }
  });

  it('在没有服务端模型密钥时明确拒绝照片识别请求', async () => {
    const app = await runningApp({ sub2ApiKey: '' });
    try {
      const response = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==' }),
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error.message).toContain('SUB2API_API_KEY');
    } finally {
      await app.close();
    }
  });
});
