import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchVisionModels, publishCatalog, recognizeImage } from './server-api';
import type { Catalog } from '../types';

const catalog: Catalog = {
  version: 'published-test',
  effectiveAt: '2026-07-28T00:00:00.000Z',
  sourceLabel: '测试价格表',
  products: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('发布价格表', () => {
  it('将 NAS 网络错误转为可显示的中文提示', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.stubGlobal('window', { localStorage: {} });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(publishCatalog(catalog, '')).rejects.toThrow('无法连接 NAS 服务，请检查网络、NAS 地址和服务状态。');
  });
});

describe('识别模型选择', () => {
  it('读取服务端模型列表，并在识别请求中携带用户选择的模型', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.stubGlobal('window', { localStorage: {} });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: ['gpt-5.5', 'claude-sonnet-4-5'], default: 'gpt-5.5' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: '{"products":[]}' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchVisionModels()).toEqual({ models: ['gpt-5.5', 'claude-sonnet-4-5'], default: 'gpt-5.5' });

    await recognizeImage('data:image/jpeg;base64,AA==', 'claude-sonnet-4-5');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({
      imageUrl: 'data:image/jpeg;base64,AA==',
      model: 'claude-sonnet-4-5',
    });
  });

  it('未指定模型时不携带 model 字段，由服务端使用默认模型', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.stubGlobal('window', { localStorage: {} });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: '{"products":[]}' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await recognizeImage('data:image/jpeg;base64,AA==');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ imageUrl: 'data:image/jpeg;base64,AA==' });
  });
});
