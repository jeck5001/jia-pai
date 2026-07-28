import { describe, expect, it } from 'vitest';
import { NAS_SERVER_URL_STORAGE_KEY, normalizeNasServerUrl, readNasServerUrl, resolveApiUrl, saveNasServerUrl, type StorageLike } from './app-config';

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('Android NAS 地址配置', () => {
  it('规范化 HTTP 和 HTTPS 根地址', () => {
    expect(normalizeNasServerUrl(' http://192.168.1.10:3000/ ')).toBe('http://192.168.1.10:3000');
    expect(normalizeNasServerUrl('https://nas.example.test/')).toBe('https://nas.example.test');
  });

  it.each(['ftp://nas.example.test', 'http://nas.example.test/api', 'http://user:pass@nas.example.test', 'http://nas.example.test?debug=1'])('拒绝不安全或不完整的 NAS 地址：%s', (value) => {
    expect(() => normalizeNasServerUrl(value)).toThrow();
  });

  it('仅原生端保存地址并生成绝对 API 地址，网页端保留相对路径', () => {
    const storage = memoryStorage();
    expect(saveNasServerUrl('http://nas.example.test:3000/', true, storage)).toBe('http://nas.example.test:3000');
    expect(storage.getItem(NAS_SERVER_URL_STORAGE_KEY)).toBe('http://nas.example.test:3000');
    expect(resolveApiUrl('/api/catalog', { isNativePlatform: true, storage })).toBe('http://nas.example.test:3000/api/catalog');
    expect(resolveApiUrl('/api/catalog', { isNativePlatform: false, storage })).toBe('/api/catalog');
    expect(() => saveNasServerUrl('http://nas.example.test:3000', false, storage)).toThrow('网页端不需要配置 NAS 地址');
  });

  it('原生端无地址时拒绝请求，损坏的保存值会被清除', () => {
    const emptyStorage = memoryStorage();
    expect(() => resolveApiUrl('/api/catalog', { isNativePlatform: true, storage: emptyStorage })).toThrow('请先连接 NAS 服务');

    const invalidStorage = memoryStorage({ [NAS_SERVER_URL_STORAGE_KEY]: 'ftp://invalid.example.test' });
    expect(readNasServerUrl(true, invalidStorage)).toBeNull();
    expect(invalidStorage.getItem(NAS_SERVER_URL_STORAGE_KEY)).toBeNull();
  });
});
