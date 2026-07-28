import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishCatalog } from './server-api';
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
