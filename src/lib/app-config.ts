export const NAS_SERVER_URL_STORAGE_KEY = 'xiaomaibu-nas-server-url';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type EndpointOptions = {
  isNativePlatform: boolean;
  storage: StorageLike;
};

export function normalizeNasServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('请输入完整的 NAS 地址，例如 http://192.168.1.10:3000');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NAS 地址仅支持 http:// 或 https://');
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('NAS 地址只能包含协议、主机名和端口，不能包含路径、账号或参数');
  }
  return url.origin;
}

export function readNasServerUrl(isNativePlatform: boolean, storage: StorageLike): string | null {
  if (!isNativePlatform) return null;
  const value = storage.getItem(NAS_SERVER_URL_STORAGE_KEY);
  if (!value) return null;
  try {
    return normalizeNasServerUrl(value);
  } catch {
    storage.removeItem(NAS_SERVER_URL_STORAGE_KEY);
    return null;
  }
}

export function saveNasServerUrl(value: string, isNativePlatform: boolean, storage: StorageLike): string {
  if (!isNativePlatform) throw new Error('网页端不需要配置 NAS 地址');
  const normalized = normalizeNasServerUrl(value);
  storage.setItem(NAS_SERVER_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function resolveApiUrl(path: string, { isNativePlatform, storage }: EndpointOptions): string {
  if (!path.startsWith('/api/')) throw new Error('API 路径必须以 /api/ 开头');
  if (!isNativePlatform) return path;
  const nasServerUrl = readNasServerUrl(true, storage);
  if (!nasServerUrl) throw new Error('请先连接 NAS 服务');
  return `${nasServerUrl}${path}`;
}
