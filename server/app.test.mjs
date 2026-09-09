import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runningApp(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'xiaomaibu-server-'));
  temporaryDirectories.push(dataDir);
  const { config, server } = await createApp({ dataDir, adminToken: 'publish-token', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    config,
    dataDir,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe('一体化服务', () => {
  it('支持通过环境配置覆盖视觉模型请求超时，并对无效值回退到三分钟', async () => {
    const configuredApp = await runningApp({ sub2ApiTimeoutMs: 240_000 });
    const fallbackApp = await runningApp({ sub2ApiTimeoutMs: 0 });
    try {
      expect(configuredApp.config.sub2ApiTimeoutMs).toBe(240_000);
      expect(fallbackApp.config.sub2ApiTimeoutMs).toBe(180_000);
    } finally {
      await configuredApp.close();
      await fallbackApp.close();
    }
  });

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

  it('实时从 Sub2API 获取模型列表，并默认选中服务端配置的模型', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'gpt-5.5' }, { id: 'gpt-5.5' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"products":[]}' } }] }), { status: 200 }));
    const app = await runningApp({ fetchImpl, sub2ApiKey: 'test-key', sub2ApiModel: 'gpt-5.5' });
    try {
      const modelsResponse = await fetch(`${app.baseUrl}/api/vision/models`);
      expect(modelsResponse.status).toBe(200);
      expect(await modelsResponse.json()).toEqual({ models: ['gpt-5.5', 'claude-sonnet-4-5'], default: 'gpt-5.5' });
      expect(fetchImpl.mock.calls[0][0]).toBe('http://192.168.5.35:8084/v1/models');
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');

      const recognizeResponse = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==', model: 'claude-sonnet-4-5' }),
      });
      expect(recognizeResponse.status).toBe(200);
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('claude-sonnet-4-5');
    } finally {
      await app.close();
    }
  });

  it('模型列表获取失败时返回可读错误，识别请求拒绝非法模型名并缺省回退默认模型', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '无权限' } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"products":[]}' } }] }), { status: 200 }));
    const app = await runningApp({ fetchImpl, sub2ApiKey: 'test-key' });
    try {
      const modelsResponse = await fetch(`${app.baseUrl}/api/vision/models`);
      expect(modelsResponse.status).toBe(502);
      expect((await modelsResponse.json()).error.message).toContain('无权限');

      const illegalResponse = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==', model: 'bad model\nname' }),
      });
      expect(illegalResponse.status).toBe(400);

      const defaultResponse = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==' }),
      });
      expect(defaultResponse.status).toBe(200);
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('gpt-5.5');
    } finally {
      await app.close();
    }
  });

  it('传递 max_tokens 并回传 finish_reason，让截断可被识别', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '{"products":[{"name":"三养火鸡面 140g","price":7}]' }, finish_reason: 'length' }],
    }), { status: 200 }));
    const app = await runningApp({ fetchImpl, sub2ApiKey: 'test-key', sub2ApiMaxTokens: 32_000 });
    try {
      const response = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==' }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        content: '{"products":[{"name":"三养火鸡面 140g","price":7}]',
        finishReason: 'length',
      });
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).max_tokens).toBe(32_000);
    } finally {
      await app.close();
    }
  });

  it('模型返回空内容时把 finish_reason 写进错误提示', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
    }), { status: 200 }));
    const app = await runningApp({ fetchImpl, sub2ApiKey: 'test-key' });
    try {
      const response = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==' }),
      });
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toContain('content_filter');
    } finally {
      await app.close();
    }
  });

  it('记录脱敏网络错误码，并返回可操作的连接失败提示', async () => {
    const connectionError = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const fetchImpl = vi.fn().mockRejectedValue(connectionError);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = await runningApp({ fetchImpl, sub2ApiBaseUrl: 'http://sub2api.example:8084', sub2ApiKey: 'test-key' });
    try {
      const response = await fetch(`${app.baseUrl}/api/vision/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: 'data:image/jpeg;base64,AA==' }),
      });
      expect(response.status).toBe(502);
      expect((await response.json()).error.message).toContain('ECONNREFUSED');
      expect(log).toHaveBeenCalledWith('[vision] Sub2API connection failed', {
        endpoint: 'http://sub2api.example:8084',
        errorCode: 'ECONNREFUSED',
        errorType: 'Error',
        timeoutMs: 180_000,
      });
    } finally {
      await app.close();
    }
  });
});
